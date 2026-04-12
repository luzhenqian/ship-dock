export interface SystemDepEntry {
  id: string;
  name: string;
  description: string;
  packages: string[];  // actual apt package names
}

export const SYSTEM_DEPS_WHITELIST: SystemDepEntry[] = [
  { id: 'ffmpeg', name: 'FFmpeg', description: 'Audio/video processing', packages: ['ffmpeg'] },
  { id: 'imagemagick', name: 'ImageMagick', description: 'Image processing & conversion', packages: ['imagemagick'] },
  { id: 'libvips', name: 'libvips', description: 'High-performance image processing', packages: ['libvips-tools'] },
  { id: 'ghostscript', name: 'Ghostscript', description: 'PDF/PostScript processing', packages: ['ghostscript'] },
  { id: 'poppler', name: 'Poppler Utils', description: 'PDF utilities (pdftotext, etc.)', packages: ['poppler-utils'] },
  { id: 'tesseract', name: 'Tesseract OCR', description: 'Optical character recognition', packages: ['tesseract-ocr'] },
  { id: 'chromium', name: 'Chromium', description: 'Headless browser for Puppeteer/Playwright', packages: ['chromium-browser'] },
  { id: 'wkhtmltopdf', name: 'wkhtmltopdf', description: 'HTML to PDF conversion', packages: ['wkhtmltopdf'] },
  { id: 'build-essential', name: 'Build Essential', description: 'C/C++ compiler for native modules', packages: ['build-essential'] },
  { id: 'python3', name: 'Python 3', description: 'Python runtime', packages: ['python3', 'python3-pip'] },
  { id: 'graphicsmagick', name: 'GraphicsMagick', description: 'Image processing (GM)', packages: ['graphicsmagick'] },
  { id: 'pdftk', name: 'PDFtk', description: 'PDF toolkit (merge, split, etc.)', packages: ['pdftk-java'] },
  { id: 'zip', name: 'Zip/Unzip', description: 'Archive compression utilities', packages: ['zip', 'unzip'] },
  { id: 'jq', name: 'jq', description: 'JSON processor', packages: ['jq'] },
  { id: 'cairo', name: 'Cairo', description: 'Canvas rendering (node-canvas)', packages: ['libcairo2-dev', 'libjpeg-dev', 'libpango1.0-dev', 'libgif-dev', 'librsvg2-dev'] },
];

export const SYSTEM_DEPS_IDS = new Set(SYSTEM_DEPS_WHITELIST.map((d) => d.id));
