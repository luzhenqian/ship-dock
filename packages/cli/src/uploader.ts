import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import * as path from 'path';

export interface UploadResult {
  success: boolean;
  importId?: string;
  error?: string;
}

export interface UploadProgress {
  bytesUploaded: number;
  totalBytes: number;
  percent: number;
}

/**
 * Upload a migration package to Ship Dock.
 * Uses built-in http/https modules to support progress tracking.
 */
export async function uploadPackage(
  packagePath: string,
  serverUrl: string,
  token: string,
  onProgress?: (progress: UploadProgress) => void,
  importId?: string,
): Promise<UploadResult> {
  const fileSize = fs.statSync(packagePath).size;
  const fileName = path.basename(packagePath);
  const boundary = `----ShipDock${Date.now()}`;

  // Build multipart form data with optional importId field
  let formPrefix = '';
  if (importId) {
    formPrefix =
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="importId"\r\n\r\n` +
      `${importId}\r\n`;
  }

  const fileHeader =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
    `Content-Type: application/gzip\r\n\r\n`;

  const header = Buffer.from(formPrefix + fileHeader);
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
  const totalSize = header.length + fileSize + footer.length;

  const url = new URL('/api/imports/upload', serverUrl);
  const isHttps = url.protocol === 'https:';
  const transport = isHttps ? https : http;

  return new Promise((resolve) => {
    const req = transport.request(
      {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': totalSize,
          Authorization: `Bearer ${token}`,
        },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => {
          body += chunk.toString();
        });
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const data = JSON.parse(body);
              resolve({ success: true, importId: data.id || data.importId });
            } catch {
              resolve({ success: true });
            }
          } else {
            resolve({
              success: false,
              error: `Server returned ${res.statusCode}: ${body}`,
            });
          }
        });
      },
    );

    req.on('error', (err) => {
      resolve({ success: false, error: err.message });
    });

    // Write the multipart header
    req.write(header);

    // Stream the file with progress tracking
    const fileStream = fs.createReadStream(packagePath);
    let bytesUploaded = header.length;

    fileStream.on('data', (chunk: string | Buffer) => {
      req.write(chunk);
      bytesUploaded += chunk.length;
      onProgress?.({
        bytesUploaded,
        totalBytes: totalSize,
        percent: Math.round((bytesUploaded / totalSize) * 100),
      });
    });

    fileStream.on('end', () => {
      req.write(footer);
      bytesUploaded += footer.length;
      onProgress?.({
        bytesUploaded: totalSize,
        totalBytes: totalSize,
        percent: 100,
      });
      req.end();
    });

    fileStream.on('error', (err) => {
      resolve({ success: false, error: `File read error: ${err.message}` });
      req.destroy();
    });
  });
}
