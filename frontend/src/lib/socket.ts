import { io, Socket } from 'socket.io-client';
import { getAccessToken } from './api';

// Backend mounts Socket.IO at /api/socket.io/ (see backend/src/main.ts) so nginx's
// /api/ proxy handles WS the same way it handles REST.
const SOCKET_PATH = '/api/socket.io/';

function getSocketUrl(): string {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';
  // Relative API URL (production: '/api'): use the page's origin.
  if (apiUrl.startsWith('/')) {
    return typeof window !== 'undefined' ? window.location.origin : '';
  }
  try {
    const url = new URL(apiUrl);
    return `${url.protocol}//${url.host}`;
  } catch {
    return apiUrl.replace(/\/api\/?$/, '') || 'http://localhost:4000';
  }
}
const SOCKET_URL = getSocketUrl();
let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) socket = io(SOCKET_URL, { path: SOCKET_PATH, auth: { token: getAccessToken() }, autoConnect: false });
  return socket;
}

export function connectSocket() {
  const s = getSocket();
  s.auth = { token: getAccessToken() };
  if (!s.connected) s.connect();
  return s;
}

export function disconnectSocket() { if (socket) { socket.disconnect(); socket = null; } }
