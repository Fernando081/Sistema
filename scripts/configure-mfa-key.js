/* Configuración local explícita, idempotente. No imprime ni rota claves existentes. */
const fs=require('node:fs'),path=require('node:path'),{randomBytes}=require('node:crypto');
if(process.versions.node.split('.')[0]!=='24')throw new Error('Se requiere Node.js24');
const file=path.resolve(__dirname,'../backend/.env');
if(!fs.existsSync(file))throw new Error('Configura primero backend/.env; no se creará una configuración completa automáticamente.');
const dotenv=require('dotenv'),source=fs.readFileSync(file,'utf8');
const existing=process.env.AUTH_MFA_ENCRYPTION_KEY||dotenv.parse(source).AUTH_MFA_ENCRYPTION_KEY;
if(existing){
  if(!/^[A-Za-z0-9+/]{43}=$/.test(existing))throw new Error('La clave MFA existente tiene formato inválido. No se modificó.');
  console.log('La clave MFA ya está configurada; se conserva sin cambios.');
}else{
  fs.appendFileSync(file,'\n# Clave local MFA: conservar respaldo separado y protegido; no compartir.\nAUTH_MFA_ENCRYPTION_KEY='+randomBytes(32).toString('base64')+'\n');
  console.log('Clave MFA local configurada en backend/.env; valor omitido. Reinicia el backend para cargarla.');
}
