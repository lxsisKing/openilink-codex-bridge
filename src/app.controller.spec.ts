import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return service metadata', () => {
      expect(appController.getHello()).toEqual(
        expect.objectContaining({
          ok: true,
          service: 'openilink-codex-bridge',
          agents: expect.any(Array),
        }),
      );
    });
  });
});
