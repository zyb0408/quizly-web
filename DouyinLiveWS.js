/**
 * DouyinLive 本地 WebSocket 客户端 SDK
 */
class DouyinLiveWS {
    /**
     * @param {Object} options 配置项
     * @param {string} options.roomId 直播间ID (必填)
     * @param {string} [options.host='127.0.0.1'] 服务端IP
     * @param {number} [options.port=1088] 服务端端口
     * @param {string} [options.cookie=''] 抖音Cookie (可选)
     * @param {boolean} [options.autoReconnect=true] 是否自动重连
     * @param {number} [options.reconnectInterval=3000] 重连间隔(毫秒)
     */
    constructor(options) {
        this.roomId = options.roomId;
        if (!this.roomId) throw new Error('roomId is required');

        this.host = options.host || '127.0.0.1';
        this.port = options.port || 1088;
        this.cookie = options.cookie || '';
        this.autoReconnect = options.autoReconnect !== false;
        this.reconnectInterval = options.reconnectInterval || 3000;
        
        this.ws = null;
        this.eventListeners = {};
        this.isDestroyed = false; // 是否主动销毁
    }

    /**
     * 构建 WebSocket URL
     */
    _buildUrl() {
        let url = `ws://${this.host}:${this.port}/ws/${this.roomId}`;
        if (this.cookie) {
            // 使用 base64 传递 cookie 避免特殊字符导致 URL 解析报错
            const b64Cookie = btoa(encodeURIComponent(this.cookie));
            url += `?cookie_b64=${b64Cookie}`;
        }
        return url;
    }

    /**
     * 发起连接
     */
    connect() {
        if (this.isDestroyed) return;
        if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) {
            return;
        }

        const url = this._buildUrl();
        console.log(`[DouyinLiveWS] 正在连接: ${url}`);
        this.ws = new WebSocket(url);

        this.ws.onopen = () => {
            console.log(`[DouyinLiveWS] 连接成功: ${this.roomId}`);
            this.emit('connected', { roomId: this.roomId });
        };

        this.ws.onmessage = (event) => {
            try {
                // 如果后端传来的是 pong 字符串（虽然代码里写了 pongMessage = "pong"，但目前主要是推 JSON）
                if (event.data === 'pong') return; 

                const data = JSON.parse(event.data);
                this._handleMessage(data);
            } catch (e) {
                console.error('[DouyinLiveWS] 消息解析失败:', event.data, e);
            }
        };

        this.ws.onclose = (event) => {
            console.log(`[DouyinLiveWS] 连接断开. Code: ${event.code}, Reason: ${event.reason}`);
            this.emit('disconnected', event);
            
            // 触发自动重连
            if (this.autoReconnect && !this.isDestroyed) {
                console.log(`[DouyinLiveWS] 将在 ${this.reconnectInterval}ms 后尝试重连...`);
                setTimeout(() => this.connect(), this.reconnectInterval);
            }
        };

        this.ws.onerror = (error) => {
            console.error('[DouyinLiveWS] WebSocket 发生错误:', error);
            this.emit('error', error);
        };
    }

    /**
     * 内部消息分发处理器
     */
    _handleMessage(data) {
        // 1. 处理系统级消息 (type: system)
        if (data.type === 'system') {
            if (data.event === 'live_status') {
                // 触发专门的直播状态事件
                this.emit('live_status', data);
            } else {
                // 触发普通系统通知
                this.emit('system', data);
            }
            return;
        }

        // 2. 处理业务消息 (按 method 分发)
        if (data.method) {
            // 触发对应类型的事件 (例如: WebcastChatMessage)
            this.emit(data.method, data);
            
            // 同时触发一个全局 message 事件，方便全量监听
            this.emit('message', data);
        }
    }

    /**
     * 监听事件
     * @param {string} eventName 事件名 (支持 connected, disconnected, live_status, system, message 以及各种 Webcast 消息)
     * @param {Function} callback 回调函数
     */
    on(eventName, callback) {
        if (!this.eventListeners[eventName]) {
            this.eventListeners[eventName] = [];
        }
        this.eventListeners[eventName].push(callback);
    }

    /**
     * 触发事件 (内部调用)
     */
    emit(eventName, data) {
        const listeners = this.eventListeners[eventName];
        if (listeners && listeners.length > 0) {
            listeners.forEach(callback => callback(data));
        }
    }

    /**
     * 主动销毁连接
     */
    destroy() {
        this.isDestroyed = true;
        this.autoReconnect = false;
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.eventListeners = {};
        console.log(`[DouyinLiveWS] 客户端已销毁`);
    }
}