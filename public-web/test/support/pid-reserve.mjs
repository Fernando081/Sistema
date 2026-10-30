// Windows reasigna pronto los PID: un bloqueo cuyo dueño (proceso de prueba) ya terminó puede verse "activo"
// si conhost.exe, git.exe u otro proceso recibe ese PID, y las pruebas de bloqueos fallan al azar con la suite en paralelo.
// Un proceso testigo retiene un handle de cada proceso Node de la suite hasta que termina el ejecutor: mientras exista
// el handle, Windows no reutiliza el PID y process.kill(pid, 0) sigue devolviendo ESRCH al terminar el proceso.
// Se carga con `node --import` en el ejecutor y llega a los procesos hijos por NODE_OPTIONS. Fuera de Windows no hace nada.
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, renameSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const pause = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const waitFor = (path, ms) => { for (const end = Date.now() + ms; Date.now() < end; pause(10)) if (existsSync(path)) return true; return false; };

if (process.platform === "win32") {
  let spool = process.env.RTT_PID_SPOOL;
  if (!spool) {
    spool = mkdtempSync(join(tmpdir(), "rtt-pid-spool-"));
    const script = `$ErrorActionPreference='Stop'; $spool=$env:RTT_PID_SPOOL; $root=[Diagnostics.Process]::GetProcessById([int]$env:RTT_PID_ROOT); [void]$root.Handle
      $held=New-Object System.Collections.ArrayList; [IO.File]::WriteAllText((Join-Path $spool 'ready'),'')
      while(-not $root.HasExited){ foreach($f in [IO.Directory]::GetFiles($spool,'*.req')){ $id=[IO.Path]::GetFileNameWithoutExtension($f)
          try{ $p=[Diagnostics.Process]::GetProcessById([int]$id); [void]$p.Handle; [void]$held.Add($p) }catch{}
          [IO.File]::Delete($f); [IO.File]::WriteAllText((Join-Path $spool "$id.ok"),'') }
        Start-Sleep -Milliseconds 10 }`;
    const holder = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script],
      { stdio: "ignore", windowsHide: true, env: { ...process.env, RTT_PID_SPOOL: spool, RTT_PID_ROOT: String(process.pid) } });
    holder.unref();
    // Si el testigo no arranca, la suite corre como antes (sin reserva) en lugar de esperar en cada proceso.
    // El ejecutor borra la carpeta al salir; el testigo puede terminar antes de limpiar si se cierra el árbol de procesos.
    const created = spool;
    process.on("exit", () => rmSync(created, { recursive: true, force: true }));
    if (waitFor(join(spool, "ready"), 20000)) {
      process.env.RTT_PID_SPOOL = spool;
      process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS ?? ""} --import=${import.meta.url}`.trim();
    } else spool = undefined;
  }
  if (spool && existsSync(join(spool, "ready"))) {
    const request = join(spool, `${process.pid}.req`);
    writeFileSync(request + ".tmp", ""); renameSync(request + ".tmp", request);
    waitFor(join(spool, `${process.pid}.ok`), 10000);
  }
}
