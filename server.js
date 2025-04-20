const WebSocket = require('ws');
const http = require('http');

// Create HTTP server
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('WebSocket chat server is running');
});

// Create WebSocket server
const wss = new WebSocket.Server({ server });

// Store rooms and their data
const rooms = {
    general: {
        users: new Set(),
        history: [],
        userCount: 0
    },
    random: {
        users: new Set(),
        history: [],
        userCount: 0
    },
    help: {
        users: new Set(),
        history: [],
        userCount: 0
    }
};

// Configuration
const MAX_HISTORY = 100;
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

// Handle WebSocket connections
wss.on('connection', (ws) => {
    let username = 'Anonymous';
    let currentRoom = null;
    
    // Send initial room list
    sendRoomList(ws);
    
    // Handle messages from client
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            
            switch(data.type) {
                case 'join':
                    handleJoin(ws, data);
                    break;
                case 'message':
                    handleMessage(ws, data);
                    break;
                case 'image':
                case 'video':
                case 'audio':
                    handleMedia(ws, data);
                    break;
                case 'create_room':
                    handleCreateRoom(ws, data);
                    break;
                case 'typing':
                    handleTyping(ws, data);
                    break;
            }
        } catch (e) {
            console.error('Error parsing message:', e);
        }
    });
    
    // Handle client disconnection
    ws.on('close', () => {
        if (currentRoom && rooms[currentRoom]) {
            leaveRoom(ws);
        }
    });
    
    // Handle errors
    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
    
    function handleJoin(ws, data) {
        if (currentRoom) leaveRoom(ws);
        
        username = data.username || 'Anonymous';
        const room = data.room || 'general';
        
        if (!rooms[room]) {
            rooms[room] = {
                users: new Set(),
                history: [],
                userCount: 0
            };
            broadcastRoomList();
        }
        
        currentRoom = room;
        rooms[room].users.add(ws);
        rooms[room].users.add(username);
        rooms[room].userCount++;
        
        broadcastToRoom(room, {
            type: 'notification',
            message: `${username} has joined the room`,
            room: room
        });
        
        sendUserList(room);
        
        if (rooms[room].history.length > 0) {
            ws.send(JSON.stringify({
                type: 'history',
                room: room,
                messages: rooms[room].history.slice(-MAX_HISTORY)
            }));
        }
    }
    
    function handleMessage(ws, data) {
        if (!currentRoom || !rooms[currentRoom]) return;
        
        const messageText = (data.message || '').toString().trim();
        if (!messageText) return;
        
        const message = {
            type: 'message',
            username: username,
            message: messageText,
            room: currentRoom,
            timestamp: Date.now()
        };
        
        rooms[currentRoom].history.push(message);
        if (rooms[currentRoom].history.length > MAX_HISTORY) {
            rooms[currentRoom].history.shift();
        }
        
        broadcastToRoom(currentRoom, message);
    }
    
    function handleMedia(ws, data) {
        if (!currentRoom || !rooms[currentRoom]) return;
        
        if (!data.fileData || !data.fileName) {
            ws.send(JSON.stringify({
                type: 'error',
                message: 'Invalid file data'
            }));
            return;
        }
        
        const mediaMessage = {
            type: data.type,
            username: username,
            fileData: data.fileData,
            fileName: data.fileName,
            room: currentRoom,
            timestamp: Date.now()
        };
        
        rooms[currentRoom].history.push(mediaMessage);
        if (rooms[currentRoom].history.length > MAX_HISTORY) {
            rooms[currentRoom].history.shift();
        }
        
        broadcastToRoom(currentRoom, mediaMessage);
    }
    
    function handleCreateRoom(ws, data) {
        const room = (data.room || '').toString().trim();
        
        if (!room) {
            ws.send(JSON.stringify({
                type: 'error',
                message: 'Room name cannot be empty'
            }));
            return;
        }
        
        if (rooms[room]) {
            ws.send(JSON.stringify({
                type: 'error',
                message: 'Room already exists'
            }));
            return;
        }
        
        rooms[room] = {
            users: new Set(),
            history: [],
            userCount: 0
        };
        
        broadcastRoomList();
        broadcast({
            type: 'notification',
            message: `New room "${room}" created`
        });
    }
    
    function handleTyping(ws, data) {
        if (!currentRoom || !rooms[currentRoom]) return;
        broadcastToRoom(currentRoom, data);
    }
    
    function leaveRoom(ws) {
        if (!rooms[currentRoom]) return;
        
        rooms[currentRoom].users.delete(ws);
        rooms[currentRoom].users.delete(username);
        rooms[currentRoom].userCount--;
        
        broadcastToRoom(currentRoom, {
            type: 'notification',
            message: `${username} has left the room`,
            room: currentRoom
        });
        
        sendUserList(currentRoom);
        
        if (rooms[currentRoom].userCount === 0 && !['general', 'random', 'help'].includes(currentRoom)) {
            delete rooms[currentRoom];
            broadcastRoomList();
        }
        
        currentRoom = null;
    }
});

// Helper functions
function broadcastToRoom(room, message) {
    if (!rooms[room]) return;
    
    const data = JSON.stringify(message);
    rooms[room].users.forEach(client => {
        if (client instanceof WebSocket && client.readyState === WebSocket.OPEN) {
            client.send(data);
        }
    });
}

function sendUserList(room) {
    if (!rooms[room]) return;
    
    const userArray = Array.from(rooms[room].users)
        .filter(user => typeof user === 'string');
    
    broadcastToRoom(room, {
        type: 'user_list',
        users: userArray
    });
}

function sendRoomList(ws) {
    const roomArray = Object.keys(rooms).map(room => room);
    
    ws.send(JSON.stringify({
        type: 'room_list',
        rooms: roomArray
    }));
}

function broadcastRoomList() {
    const roomArray = Object.keys(rooms).map(room => room);
    
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({
                type: 'room_list',
                rooms: roomArray
            }));
        }
    });
}

function broadcast(message) {
    const data = JSON.stringify(message);
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(data);
        }
    });
}

// Start the server
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
