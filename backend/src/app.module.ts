// backend/src/app.module.ts

import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { ClientThrottlerGuard } from './common/client-throttler.guard';
import { ServeStaticModule } from '@nestjs/serve-static';
import { UPLOAD_DIRECTORY } from './upload/upload-path';

// Módulos de Negocio
import { ClienteModule } from './cliente/cliente.module';
import { ProveedorModule } from './proveedor/proveedor.module';
import { ProductoModule } from './producto/producto.module';
import { WebCatalogModule } from './web-catalog/web-catalog.module';
import { CategoriaModule } from './categoria/categoria.module';

import { CompraModule } from './compra/compra.module';

// Módulo Padre de Catálogos (¡Solo importamos este!)
import { CatalogosModule } from './catalogos/catalogos.module';

import { parseSsl } from './db-ssl.util';
import { VentaModule } from './venta/venta.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { CotizacionModule } from './cotizacion/cotizacion.module';
import { PagoModule } from './pago/pago.module';
import { PagoProveedorModule } from './pago-proveedor/pago-proveedor.module';
import { AuthModule } from './auth/auth.module';
import { PortalModule } from './portal/portal.module';
import { ReportesModule } from './reportes/reportes.module';
import { FinanzasModule } from './finanzas/finanzas.module';
import { UploadModule } from './upload/upload.module';
import { AuditoriaModule } from './auditoria/auditoria.module';
import { CrmModule } from './crm/crm.module';
import { GarantiaModule } from './garantia/garantia.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { RolesGuard } from './auth/roles.guard';
import { PermissionsGuard } from './auth/permissions.guard';
import { HealthController } from './health.controller';
import { CajaModule } from './caja/caja.module';
import { PedidoModule } from './pedido/pedido.module';
import { AbastecimientoModule } from './abastecimiento/abastecimiento.module';
import { CuentasProveedorModule } from './cuentas-proveedor/cuentas-proveedor.module';
import { ComercialModule } from './comercial/comercial.module';
import { AlmacenModule } from './almacen/almacen.module';
import { NotificationModule } from './notification/notification.module';
import { VistasGuardadasModule } from './vistas-guardadas/vistas-guardadas.module';
import { FiscalSeguimientoModule } from './fiscal-seguimiento/fiscal-seguimiento.module';
import { FiscalModule } from './fiscal/fiscal.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', 'backend/.env'],
    }),
    ThrottlerModule.forRoot([{
      ttl: 60000,
      limit: 100,
    }]),
    ScheduleModule.forRoot(),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const databaseUrl = configService.get<string>('DATABASE_URL');

        if (databaseUrl) {
          return {
            type: 'postgres' as const,
            url: databaseUrl,
            autoLoadEntities: true,
            synchronize: false,
            ssl: parseSsl(configService),
          };
        }

        const password = configService.get<string>('DB_PASSWORD');
        const database = configService.get<string>('DB_NAME');
        if (!password || !database) {
          throw new Error('Configura DATABASE_URL o DB_PASSWORD y DB_NAME.');
        }
        return {
          type: 'postgres' as const,
          host: configService.get<string>('DB_HOST', '127.0.0.1'),
          port: parseInt(configService.get<string>('DB_PORT', '5432'), 10),
          username: configService.get<string>('DB_USER', 'postgres'),
          password,
          database,
          autoLoadEntities: true,
          synchronize: false,
          ssl: parseSsl(configService),
        };
      },
    }),
    ServeStaticModule.forRoot({
      rootPath: UPLOAD_DIRECTORY,
      serveRoot: '/uploads',
      serveStaticOptions: { index: false, dotfiles: 'deny', fallthrough: false },
    }),
    ClienteModule,
    ProveedorModule,
    ProductoModule,
    WebCatalogModule,
    CategoriaModule,
    CatalogosModule,
    VentaModule,
    CompraModule,
    DashboardModule,
    CotizacionModule,
    PagoModule,
    PagoProveedorModule,
    AuthModule,
    PortalModule,
    ReportesModule,
    FinanzasModule,
    UploadModule,
    AuditoriaModule,
    CrmModule,
    GarantiaModule,
    CajaModule,
    PedidoModule,
    AbastecimientoModule,
    CuentasProveedorModule,
    ComercialModule,
    AlmacenModule,
    NotificationModule,
    VistasGuardadasModule,
    FiscalSeguimientoModule,
    FiscalModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ClientThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
