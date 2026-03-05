const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('./dist/app.module');
const { FinanzasService } = require('./dist/finanzas/finanzas.service');

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const finanzasService = app.get(FinanzasService);
  
  try {
    console.log("Probando getSaldos...");
    const saldos = await finanzasService.getSaldos();
    console.log("Saldos OK:", saldos);
  } catch (e) {
    console.error("Error en getSaldos:", e.message, e.code);
  }

  try {
    console.log("Probando findAllGastos...");
    const gastos = await finanzasService.findAllGastos();
    console.log("Gastos OK:", gastos);
  } catch (e) {
    console.error("Error en findAllGastos:", e.message, e.code);
  }
  
  await app.close();
}
bootstrap();
