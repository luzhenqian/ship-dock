import { Test } from '@nestjs/testing';
import { StaticFilesService } from './static-files.service';
import { PrismaService } from '../common/prisma.service';

const mockPrisma = {
  staticFile: {
    findMany: jest.fn(),
    upsert: jest.fn(),
    delete: jest.fn(),
  },
};

describe('StaticFilesService', () => {
  let service: StaticFilesService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        StaticFilesService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(StaticFilesService);
    jest.clearAllMocks();
  });

  it('list returns all files for project', async () => {
    mockPrisma.staticFile.findMany.mockResolvedValue([
      { id: '1', projectId: 'p1', path: 'index.html', content: '<h1>Hi</h1>', updatedAt: new Date() },
    ]);
    const result = await service.list('p1');
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('index.html');
    expect(mockPrisma.staticFile.findMany).toHaveBeenCalledWith({ where: { projectId: 'p1' }, orderBy: { path: 'asc' } });
  });

  it('upsert creates or updates a file', async () => {
    mockPrisma.staticFile.upsert.mockResolvedValue({ id: '1', projectId: 'p1', path: 'index.html', content: '<h1>X</h1>', updatedAt: new Date() });
    await service.upsert('p1', 'index.html', '<h1>X</h1>');
    expect(mockPrisma.staticFile.upsert).toHaveBeenCalledWith({
      where: { projectId_path: { projectId: 'p1', path: 'index.html' } },
      create: { projectId: 'p1', path: 'index.html', content: '<h1>X</h1>' },
      update: { content: '<h1>X</h1>' },
    });
  });

  it('remove deletes a file', async () => {
    mockPrisma.staticFile.delete.mockResolvedValue({});
    await service.remove('p1', 'index.html');
    expect(mockPrisma.staticFile.delete).toHaveBeenCalledWith({
      where: { projectId_path: { projectId: 'p1', path: 'index.html' } },
    });
  });

  it('validatePath rejects path traversal', () => {
    expect(() => service.validatePath('../etc/passwd')).toThrow();
    expect(() => service.validatePath('/etc/passwd')).toThrow();
    expect(() => service.validatePath('')).toThrow();
  });
});
