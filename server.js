const WebSocket = require('ws');
const http = require('http');
const path = require('path');
const fs = require('fs');

// Create HTTP server
const server = http.createServer((req, res) => {
    if (req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        fs.createReadStream(path.join(__dirname, 'index.html')).pipe(res);
    } else {
        res.writeHead(404);
        res.end();
    }
});

// Create WebSocket server
const wss = new WebSocket.Server({ server });

// Store rooms and their data
const rooms = {
    general: {
        users: new Set(),    // Stores both usernames and WebSocket connections
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
const MAX_HISTORY = 100;           // Max messages to store per room
const MAX_IMAGE_SIZE = 2 * 1024 * 1024; // 2MB
const ALLOWED_FILE_TYPES = ['image/jpeg', 'image/png', 'image/gif'];

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
                    handleImage(ws, data);
                    break;
                case 'create_room':
                    handleCreateRoom(ws, data);
                    break;
            }
        } catch (e) {
            console.error('Error parsing message:', e);
            ws.send(JSON.stringify({
                type: 'error',
                message: 'Invalid message format'
            }));
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
        // Leave previous room if any
        if (currentRoom) {
            leaveRoom(ws);
        }
        
        // Set username and new room
        username = data.username || 'Anonymous';
        const room = data.room || 'general';
        
        // Create room if it doesn't exist
        if (!rooms[room]) {
            rooms[room] = {
                users: new Set(),
                history: [],
                userCount: 0
            };
            broadcastRoomList();
        }
        
        // Join new room
        currentRoom = room;
        rooms[room].users.add(ws);
        rooms[room].users.add(username);
        rooms[room].userCount++;
        
        // Send join notification to room
        broadcastToRoom(room, {
            type: 'notification',
            message: `${username} has joined the room`,
            room: room
        });
        
        // Send current user list to all in room
        sendUserList(room);
        
        // Send message history to joining user
        if (rooms[room].history.length > 0) {
            ws.send(JSON.stringify({
                type: 'history',
                room: room,
                messages: rooms[room].history.slice(-MAX_HISTORY) // Send last N messages
            }));
        }
    }
    
    function handleMessage(ws, data) {
        if (!currentRoom || !rooms[currentRoom]) return;
        
        // Validate message
        const messageText = (data.message || '').toString().trim();
        if (!messageText) return;
        
        const message = {
            type: 'message',
            username: username,
            message: messageText,
            room: currentRoom,
            timestamp: Date.now()
        };
        
        // Add to room history
        rooms[currentRoom].history.push(message);
        
        // Trim history if too long
        if (rooms[currentRoom].history.length > MAX_HISTORY) {
            rooms[currentRoom].history.shift();
        }
        
        // Broadcast message to room
        broadcastToRoom(currentRoom, message);
    }
    
    function handleImage(ws, data) {
        if (!currentRoom || !rooms[currentRoom]) return;
        
        // Validate image data
        if (!data.imageData || !data.fileName) {
            ws.send(JSON.stringify({
                type: 'error',
                message: 'Invalid image data'
            }));
            return;
        }
        
        // In production, you should:
        // 1. Upload to cloud storage (AWS S3, Firebase, etc.)
        // 2. Store only the URL in history
        // 3. Validate the image more thoroughly
        
        const imageMessage = {
            type: 'image',
            username: username,
            imageData: data.imageData,
            fileName: data.fileName,
            room: currentRoom,
            timestamp: Date.now()
        };
        
        // Add to room history
        rooms[currentRoom].history.push(imageMessage);
        
        // Trim history if too long
        if (rooms[currentRoom].history.length > MAX_HISTORY) {
            rooms[currentRoom].history.shift();
        }
        
        // Broadcast image to room
        broadcastToRoom(currentRoom, imageMessage);
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
        
        // Create new room
        rooms[room] = {
            users: new Set(),
            history: [],
            userCount: 0
        };
        
        broadcastRoomList();
        
        // Notify all users about new room
        broadcast({
            type: 'notification',
            message: `New room "${room}" created`
        });
    }
    
    function leaveRoom(ws) {
        if (!rooms[currentRoom]) return;
        
        // Remove user from room
        rooms[currentRoom].users.delete(ws);
        rooms[currentRoom].users.delete(username);
        rooms[currentRoom].userCount--;
        
        // Send leave notification to room
        broadcastToRoom(currentRoom, {
            type: 'notification',
            message: `${username} has left the room`,
            room: currentRoom
        });
        
        // Send updated user list to room
        sendUserList(currentRoom);
        
        // Delete room if empty (optional)
        if (rooms[currentRoom].userCount === 0 && currentRoom !== 'general' && 
            currentRoom !== 'random' && currentRoom !== 'help') {
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
        .filter(user => typeof user === 'string'); // Filter out WebSocket objects
    
    broadcastToRoom(room, {
        type: 'user_list',
        users: userArray
    });
}

function sendRoomList(ws) {
    const roomArray = Object.keys(rooms).map(room => ({
        name: room,
        userCount: rooms[room].userCount
    }));
    
    ws.send(JSON.stringify({
        type: 'room_list',
        rooms: roomArray
    }));
}

function broadcastRoomList() {
    const roomArray = Object.keys(rooms).map(room => ({
        name: room,
        userCount: rooms[room].userCount
    }));
    
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
    console.log(`WebSocket server ready on ws://localhost:${PORT}`);
});
