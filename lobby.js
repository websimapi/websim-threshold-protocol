// Handles Websim socket and messaging protocol

export class Lobby {
    constructor() {
        this.room = new window.WebsimSocket();
        this.handlers = {};
        this.clientId = null;
        this.peers = [];
    }

    async init() {
        await this.room.initialize();
        this.clientId = this.room.clientId;
        
        this.room.onmessage = (event) => {
            const msg = event.data;
            if (this.handlers[msg.type]) {
                this.handlers[msg.type](msg, event.clientId);
            }
        };

        // Track peers
        this.room.subscribePresence((presence) => {
            this.peers = Object.keys(presence).filter(id => id !== this.clientId);
            if (this.handlers['presence_change']) {
                this.handlers['presence_change'](this.peers);
            }
        });

        // Use room state for epoch tracking
        this.room.subscribeRoomState((state) => {
            if (this.handlers['state_change']) {
                this.handlers['state_change'](state);
            }
        });
    }

    on(type, callback) {
        this.handlers[type] = callback;
    }

    broadcast(type, payload) {
        this.room.send({
            type,
            ...payload,
            senderId: this.clientId
        });
    }

    // Direct message simulation (receivers filter by targetId)
    sendTo(targetId, type, payload) {
        this.room.send({
            type,
            targetId,
            ...payload,
            senderId: this.clientId
        });
    }

    get isHost() {
        // Simple host election: First joined or explicitly set
        // For this demo, we can just check if we are the "creator" logic, 
        // but Websim doesn't enforce ownership. 
        // We will assume the user manually decides or lowest ID is host.
        // Let's rely on app.js logic to assign role.
        return true; 
    }
    
    updateRoomState(update) {
        this.room.updateRoomState(update);
    }
    
    get state() {
        return this.room.roomState;
    }
}

