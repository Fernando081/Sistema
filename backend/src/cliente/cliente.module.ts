// backend/src/cliente/cliente.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Cliente } from './cliente.entity';
import { ClienteController } from './cliente.controller';
import { ClienteService } from './cliente.service';

@Module({
  imports: [TypeOrmModule.forFeature([Cliente])],
  controllers: [ClienteController],
  providers: [ClienteService],
})
export class ClienteModule {}
