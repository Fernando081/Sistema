import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { AuthService } from './auth.service';
import { AuthUser } from './auth-user.entity';

describe('AuthService', () => {
  let service: AuthService;
  let loggerErrorSpy: jest.SpyInstance;
  let loggerLogSpy: jest.SpyInstance;

  const repoMock = {
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  } as unknown as Repository<AuthUser>;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.AUTH_USERNAME = 'admin';
    process.env.AUTH_PASSWORD = 'admin123';
    process.env.JWT_SECRET = 'test-secret';
    repoMock.findOne = jest.fn().mockResolvedValue(null);
    repoMock.create = jest.fn((entity) => entity);
    repoMock.save = jest.fn((entity) =>
      Promise.resolve({ idUser: 1, ...entity }),
    );
    service = new AuthService(repoMock);
    loggerErrorSpy = jest.spyOn(service['logger'], 'error');
    loggerLogSpy = jest.spyOn(service['logger'], 'log');
  });

  afterEach(() => {
    loggerErrorSpy.mockRestore();
    loggerLogSpy.mockRestore();
  });

  it('genera token válido con credenciales fallback correctas', async () => {
    const response = await service.login('admin', 'admin123');
    expect(response.access_token).toBeTruthy();
    const payload = service.verify(response.access_token);
    expect(payload.sub).toBe('admin');
  });

  it('rechaza credenciales inválidas', async () => {
    await expect(service.login('admin', 'mal-password')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('registra usuario con password hasheado', async () => {
    const result = await service.register(
      'nuevo-admin',
      'password123',
      'admin',
    );

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(repoMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        username: 'nuevo-admin',
        role: 'admin',
        isActive: true,
      }),
    );

    const createCalls = (repoMock.create as jest.Mock).mock.calls as Array<
      [Partial<AuthUser>]
    >;
    const createdUser = createCalls[0]?.[0];

    expect(createdUser?.passwordHash).toContain(':');
    expect(createdUser?.passwordHash).not.toContain('password123');
    expect(result).toEqual({
      idUser: 1,
      username: 'nuevo-admin',
      role: 'admin',
    });
  });

  it('usa rol por defecto cuando no se proporciona', async () => {
    const result = await service.register('nuevo-por-defecto', 'password456');

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(repoMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        username: 'nuevo-por-defecto',
        role: 'admin',
        isActive: true,
      }),
    );

    const createCalls = (repoMock.create as jest.Mock).mock.calls as Array<
      [Partial<AuthUser>]
    >;
    const createdUser = createCalls[createCalls.length - 1]?.[0];

    expect(createdUser?.passwordHash).toContain(':');
    expect(createdUser?.passwordHash).not.toContain('password456');
    expect(result).toEqual({
      idUser: 1,
      username: 'nuevo-por-defecto',
      role: 'admin',
    });
  });
  it('impide registrar usuario duplicado', async () => {
    repoMock.findOne = jest
      .fn()
      .mockResolvedValue({ idUser: 99, username: 'repetido' });

    await expect(
      service.register('repetido', 'password123', 'admin'),
    ).rejects.toThrow(ConflictException);
  });

  it('registra exitosamente y registra evento de auditoría', async () => {
    const result = await service.register(
      'usuario-con-log',
      'password789',
      'user',
    );

    expect(result).toEqual({
      idUser: 1,
      username: 'usuario-con-log',
      role: 'user',
    });

    expect(loggerLogSpy).toHaveBeenCalledWith(
      'User registered successfully: username=usuario-con-log, role=user, idUser=1',
    );
  });

  it('maneja condición de carrera con violación de constraint único', async () => {
    const uniqueViolationError = Object.assign(new Error('duplicate key'), {
      code: '23505',
    });

    repoMock.save = jest.fn().mockRejectedValue(uniqueViolationError);

    await expect(
      service.register('usuario-duplicado', 'password123', 'admin'),
    ).rejects.toThrow(ConflictException);

    await expect(
      service.register('usuario-duplicado', 'password123', 'admin'),
    ).rejects.toThrow('El usuario ya existe');
  });

  it('valida usuario desde BD con hash', async () => {
    const passwordHash = AuthService.hashPassword('secreto');
    repoMock.findOne = jest.fn().mockResolvedValue({
      username: 'fer',
      role: 'admin',
      passwordHash,
      isActive: true,
    });

    const response = await service.login('fer', 'secreto');
    expect(response.access_token).toBeTruthy();
  });

  it('rechaza hash sin separador de colon', async () => {
    const invalidHash = 'noseparatorhere';
    repoMock.findOne = jest.fn().mockResolvedValue({
      username: 'fer',
      role: 'admin',
      passwordHash: invalidHash,
      isActive: true,
    });

    await expect(service.login('fer', 'cualquier-password')).rejects.toThrow(
      UnauthorizedException,
    );
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      'Invalid password hash format: expected format with colon separator (salt:hash)',
    );
  });

  it('rechaza hash con múltiples separadores', async () => {
    // Create a valid hash first, then append :extra to test the parts.length !== 2 validation
    const validHash = AuthService.hashPassword('test');
    const invalidHash = `${validHash}:extra`;
    repoMock.findOne = jest.fn().mockResolvedValue({
      username: 'fer',
      role: 'admin',
      passwordHash: invalidHash,
      isActive: true,
    });

    await expect(service.login('fer', 'cualquier-password')).rejects.toThrow(
      UnauthorizedException,
    );
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      'Invalid password hash format: expected exactly one colon separator but found 2',
    );
  });

  it('rechaza hash con salt vacío', async () => {
    const invalidHash = ':onlyhash';
    repoMock.findOne = jest.fn().mockResolvedValue({
      username: 'fer',
      role: 'admin',
      passwordHash: invalidHash,
      isActive: true,
    });

    await expect(service.login('fer', 'cualquier-password')).rejects.toThrow(
      UnauthorizedException,
    );
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      'Invalid password hash format: salt or hash is empty',
    );
  });

  it('rechaza hash con valor hash vacío', async () => {
    const invalidHash = 'onlysalt:';
    repoMock.findOne = jest.fn().mockResolvedValue({
      username: 'fer',
      role: 'admin',
      passwordHash: invalidHash,
      isActive: true,
    });

    await expect(service.login('fer', 'cualquier-password')).rejects.toThrow(
      UnauthorizedException,
    );
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      'Invalid password hash format: salt or hash is empty',
    );
  });

  it('rechaza hash nulo', async () => {
    repoMock.findOne = jest.fn().mockResolvedValue({
      username: 'fer',
      role: 'admin',
      passwordHash: null,
      isActive: true,
    });

    await expect(service.login('fer', 'cualquier-password')).rejects.toThrow(
      UnauthorizedException,
    );
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      'Invalid password hash: storedHash is null, undefined, empty, or not a string',
    );
  });
});
