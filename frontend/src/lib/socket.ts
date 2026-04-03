import { io, Socket } from 'socket.io-client';
import { getAccessToken } from './api';

const SOCKET_URL = process.env.NEXT_PUBLIC_API_URL?.replace('/api', '') || 'http://localhost:4000';
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
