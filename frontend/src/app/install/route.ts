import { NextResponse } from 'next/server';

const INSTALL_SCRIPT_URL =
  'https://raw.githubusercontent.com/luzhenqian/ship-dock/main/scripts/install.sh';

export async function GET() {
  const res = await fetch(INSTALL_SCRIPT_URL, { next: { revalidate: 60 } });
  if (!res.ok) {
    return new NextResponse('Failed to fetch install script', { status: 502 });
  }
  const script = await res.text();
  return new NextResponse(script, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
