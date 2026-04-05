import { io, Socket } from 'socket.io-client';
import { getAccessToken } from './api';

function getSocketUrl(): string {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';
  try {
    const url = new URL(apiUrl);
    return `${url.protocol}//${url.host}`;
  } catch {
    // Fallback: strip /api suffix
    return apiUrl.replace(/\/api\/?$/, '') || 'http://localhost:4000';
  }
}
const SOCKET_URL = getSocketUrl();
let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) socket = io(SOCKET_URL, { auth: { token: getAccessToken() }, autoConnect: false });
  return socket;
}

export function connectSocket() {
  const s = getSocket();
  s.auth = { token: getAccessToken() };
  if (!s.connected) s.connect();
  return s;
}

export function disconnectSocket() { if (socket) { socket.disconnect(); socket = null; } }
