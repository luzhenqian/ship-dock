import { Injectable } from '@nestjs/common';

@Injectable()
export class ImportService {
  async createUploadToken(): Promise<any> {
    throw new Error('Not implemented');
  }

  async handleUpload(_file: any): Promise<any> {
    throw new Error('Not implemented');
  }

  async getUpload(_id: string): Promise<any> {
    throw new Error('Not implemented');
  }

  async createImport(_userId: string, _dto: any): Promise<any> {
    throw new Error('Not implemented');
  }

  async getImport(_id: string): Promise<any> {
    throw new Error('Not implemented');
  }

  async updateConfig(_id: string, _dto: any): Promise<any> {
    throw new Error('Not implemented');
  }

  async startImport(_id: string): Promise<any> {
    throw new Error('Not implemented');
  }

  async cancelImport(_id: string): Promise<any> {
    throw new Error('Not implemented');
  }

  async deleteImport(_id: string): Promise<any> {
    throw new Error('Not implemented');
  }

  async testConnection(_dto: any): Promise<any> {
    throw new Error('Not implemented');
  }
}
