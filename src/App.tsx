import { useEffect, useMemo, useRef, useState } from "react";

/**
 * OTP (One‑Time Pad) — React single‑file component (Pasos guiados)
 *
 * Flujo solicitado (paso a paso):
 * 1) Pantalla inicial: elegir Cifrar o Descifrar.
 * 2) Cifrar: mostrar SOLO textarea del mensaje + botones Cifrar/Limpiar.
 * 3) Al Cifrar: mostrar PAD/Clave debajo del textarea (solo visual) y el texto cifrado (resultado).
 * 4) Descifrar: primero pedir PAD/Clave.
 * 5) Luego mostrar textarea para pegar texto cifrado + botón Descifrar (y Limpiar aparte).
 * 6) Al descifrar: mostrar el MENSAJE y un cronómetro de 5 minutos. Al terminar, limpiar todo.
 *
 * Detalles técnicos:
 * - Alfabeto unificado (A–Z, Ñ, espacio, 0–9 y signos comunes). Sin selector de alfabeto/normalización.
 * - Normalización fija (quita tildes, filtra símbolos fuera del alfabeto). PAD es solo visual.
 * - Web Crypto para generar PAD aleatorio (cifrado). Todo local.
 * - Self‑tests por consola.
 */

// Alfabeto unificado: incluye letras, Ñ, dígitos, espacio y signos comunes
const UNIFIED_ALPHABET =
  "ABCDEFGHIJKLMNÑOPQRSTUVWXYZ0123456789 !?,.:;-_()@#$/+*=<>\\\"'[]{}";
// Nota: \\" representa comillas y \\\\ representa backslash dentro de string.

function normalizeInput(input: string, alphabet: string): string {
  let s = input.toUpperCase();
  // Quitar diacríticos (áéíóú → AEIOU)
  s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  // Filtrar caracteres no presentes en el alfabeto
  let out = "";
  for (const ch of s) if (alphabet.includes(ch)) out += ch;
  return out;
}

const toIndices = (text: string, alphabet: string) => [...text].map((ch) => alphabet.indexOf(ch));
const fromIndices = (arr: number[], alphabet: string) => arr.map((i) => alphabet[i]).join("");

const otpAdd = (m: number[], p: number[], mod: number) => m.map((v, i) => (v + p[i]) % mod);
const otpSub = (c: number[], p: number[], mod: number) => c.map((v, i) => ((v - p[i]) % mod + mod) % mod);

function randomPad(len: number, alphabet: string): string {
  const mod = alphabet.length;
  const buf = new Uint32Array(len);
  crypto.getRandomValues(buf);
  const idx = Array.from(buf, (n) => n % mod);
  return fromIndices(idx, alphabet);
}

function useClipboard() {
  const [copied, setCopied] = useState<null | "pad" | "cipher">(null);
  async function copy(kind: "pad" | "cipher", text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      setTimeout(() => setCopied(null), 1200);
    } catch {
      // noop
    }
  }
  return { copied, copy };
}

function useDownload() {
  const aRef = useRef<HTMLAnchorElement | null>(null);
  function downloadText(filename: string, content: string) {
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = aRef.current ?? document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
  return { link: aRef, downloadText };
}

export default function OTPApp() {
  // Paso 1: pantalla inicial
  const [modeScreen, setModeScreen] = useState<null | "encrypt" | "decrypt">(null);

  // Descifrar paso previo (4→5)
  const [decryptStep, setDecryptStep] = useState<"askPad" | "ready">("askPad");
  const [padInput, setPadInput] = useState("");

  // Estado principal
  const [message, setMessage] = useState("");
  const [cipher, setCipher] = useState("");
  const [pad, setPad] = useState("");
  const [status, setStatus] = useState<{ text: string; tone?: "ok" | "warn" | "err" }>({ text: "Listo." });

  // Cifra: mostrar PAD y cifrado tras presionar Cifrar.
  const [showEncryptResults, setShowEncryptResults] = useState(false);

  // Descifrar: cronómetro 5 min tras mostrar mensaje
  const [countdown, setCountdown] = useState<number | null>(null); // en segundos

  const { link, downloadText } = useDownload();
  const { copy, copied } = useClipboard();

  const alphabet = useMemo(() => UNIFIED_ALPHABET, []);
  const modulus = alphabet.length;

  const setOK = (t: string) => setStatus({ text: t, tone: "ok" });
  const setWarn = (t: string) => setStatus({ text: t, tone: "warn" });
  const setErr = (t: string) => setStatus({ text: t, tone: "err" });

  // Reset al cambiar de modo o al limpiar
  function resetAll() {
    setMessage("");
    setCipher("");
    setPad("");
    setPadInput("");
    setDecryptStep("askPad");
    setShowEncryptResults(false);
    setCountdown(null);
    setStatus({ text: "Listo." });
  }

  useEffect(() => {
    resetAll();
  }, [modeScreen]);

  // Self‑tests mínimos (no bloquean UI)
  useEffect(() => {
    try {
      const A = alphabet;
      // Test 1: ida/vuelta con suma/resta modular
      const msg = "HOLA MUNDO";
      const padT = randomPad(msg.length, A);
      const mi = toIndices(msg, A);
      const pi = toIndices(padT, A);
      const ci = otpAdd(mi, pi, A.length);
      const back = otpSub(ci, pi, A.length);
      console.assert(fromIndices(back, A) === msg, "Roundtrip failed (unified)");

      // Test 2: normalización
      const norm = normalizeInput("canción NIÑO 123 !", A);
      console.assert(norm === "CANCION NIÑO 123 !", "Normalization failed (expected diacritics removed, Ñ preserved)");

      // Test 3: longitud de pad aleatorio
      const rnd = randomPad(10, A);
      console.assert(rnd.length === 10, "Random pad length mismatch");

      // Test 4: signos comunes están en alfabeto
      const sample = "@#$/+*<>[]{}()";
      const normSig = normalizeInput(sample, A);
      console.assert(normSig === sample, "Unified alphabet missing common signs");
    } catch (e) {
      console.warn("Self-test warning:", e);
    }
  }, [alphabet]);

  // Cifrar
  function onEncrypt() {
    try {
      const norm = normalizeInput(message, alphabet);
      if (!norm.length) throw new Error("Escribe el mensaje que quieres cifrar.");

      const newPad = randomPad(norm.length, alphabet);
      const mi = toIndices(norm, alphabet);
      const pi = toIndices(newPad, alphabet);
      const ci = otpAdd(mi, pi, modulus);
      const ct = fromIndices(ci, alphabet);

      setPad(newPad); // Mostrar PAD debajo del textarea
      setCipher(ct);  // Mostrar resultado del cifrado
      setShowEncryptResults(true);
      setOK("Cifrado listo. Copia el pad y el texto cifrado.");
    } catch (e: any) {
      setErr(e.message || String(e));
    }
  }

  // Aceptar PAD para descifrar (paso 4 → 5)
  function onAcceptPadForDecrypt() {
    try {
      const pNorm = normalizeInput(padInput, alphabet);
      if (!pNorm.length) throw new Error("Pega primero el PAD / Clave.");
      setPad(pNorm);
      setDecryptStep("ready");
      setOK("PAD listo. Ahora pega el texto cifrado y presiona Descifrar.");
    } catch (e: any) {
      setErr(e.message || String(e));
    }
  }

  // Descifrar
  function onDecrypt() {
    try {
      if (decryptStep !== "ready") throw new Error("Primero proporciona el PAD / Clave.");
      const c = normalizeInput(cipher, alphabet);
      const p = pad;
      if (!c.length) throw new Error("Pega el texto cifrado.");
      if (c.length !== p.length) throw new Error(`El pad debe tener la MISMA longitud. (cifrado=${c.length}, pad=${p.length})`);

      const ci = toIndices(c, alphabet);
      const pi = toIndices(p, alphabet);
      const mi = otpSub(ci, pi, modulus);
      const plain = fromIndices(mi, alphabet);
      setMessage(plain);
      setOK("Descifrado recuperado. El mensaje se limpiará automáticamente en 5 minutos.");
      setCountdown(5 * 60); // 5 minutos
    } catch (e: any) {
      setErr(e.message || String(e));
    }
  }

  // Cronómetro de 5 minutos (descifrado)
  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) {
      resetAll();
      return;
    }
    const t = setInterval(() => setCountdown((s) => (s ?? 1) - 1), 1000);
    return () => clearInterval(t);
  }, [countdown]);

  function onExportPad() {
    const content = pad.trim();
    if (!content) return setWarn("No hay pad para exportar.");
    downloadText("pad.txt", content);
    setOK("Pad exportado como pad.txt");
  }

  function onClearAll() {
    resetAll();
  }

  const toneClass =
    status.tone === "ok"
      ? "text-green-400"
      : status.tone === "warn"
      ? "text-amber-300"
      : status.tone === "err"
      ? "text-rose-400"
      : "text-slate-400";

  // Paso 1: pantalla inicial
  if (!modeScreen) {
    return (
      <div className="min-h-screen bg-slate-900 text-slate-100 flex items-center justify-center p-6">
        <div className="flex flex-col gap-4 w-full max-w-xs">
          <button onClick={() => setModeScreen("encrypt")} className="px-4 py-3 bg-blue-600 rounded-lg font-semibold">Cifrar</button>
          <button onClick={() => setModeScreen("decrypt")} className="px-4 py-3 bg-green-600 rounded-lg font-semibold">Descifrar</button>
        </div>
      </div>
    );
  }

  // Paso 4: pedir PAD antes de mostrar campos de descifrado
  if (modeScreen === "decrypt" && decryptStep === "askPad") {
    return (
      <div className="min-h-screen bg-slate-900 text-slate-100 flex items-center justify-center p-6">
        <div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-800/60 p-5 grid gap-4">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-semibold">Descifrar — Proveer Clave única</h1>
            <button onClick={() => setModeScreen(null)} className="text-xs underline">← Volver</button>
          </div>
          <label className="block text-sm text-slate-300">Pega aquí tu Clave única</label>
          <textarea
            className="min-h-[120px] w-full rounded-lg border border-slate-600 bg-slate-900 p-3 font-mono text-sm tracking-wide"
            placeholder="Pega el PAD (se normalizará automáticamente)"
            value={padInput}
            onChange={(e) => setPadInput(e.target.value)}
          />
          <div className="flex gap-2">
            <button onClick={onAcceptPadForDecrypt} className="px-4 py-2 bg-green-600 rounded-lg font-semibold">Usar este PAD</button>
            <button onClick={onClearAll} className="px-4 py-2 bg-rose-600 rounded-lg font-semibold">Limpiar</button>
          </div>
          <div className={`text-xs ${toneClass}`}>{status.text}</div>
        </div>
      </div>
    );
  }

  // Pantallas principales según modo (2,3 y 5,6)
  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 p-6">
      <a ref={link} style={{ display: "none" }} />
      <div className="max-w-3xl mx-auto grid gap-4">
        <header className="flex items-center justify-between">
          <h1 className="text-xl font-semibold">OTP (One‑Time Pad) — Pasos</h1>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <button onClick={() => setModeScreen(null)} className="underline">← Volver</button>
            <span>Local (navegador)</span>
          </div>
        </header>

        {/* CIFRAR (2 y 3) */}
        {modeScreen === "encrypt" && (
          <section className="rounded-2xl border border-slate-700 bg-slate-800/60 p-4 grid gap-4">
            <div className="grid gap-2">
              <label className="block text-sm text-slate-300">Mensaje (plano)</label>
              <textarea
                className="min-h-[120px] w-full rounded-lg border border-slate-600 bg-slate-900 p-3 font-mono text-sm tracking-wide"
                placeholder="Escribe tu mensaje…"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
              <div className="flex gap-2">
                <button onClick={onEncrypt} className="px-4 py-2 bg-blue-600 rounded-lg font-semibold">Cifrar</button>
                <button onClick={onClearAll} className="px-4 py-2 bg-rose-600 rounded-lg font-semibold">Limpiar</button>
              </div>
            </div>

            {showEncryptResults && (
              <div className="grid gap-4">
                <div className="grid gap-2">
                  <label className="block text-sm text-slate-300">Pad / Clave (solo visual)</label>
                  <textarea
                    className="min-h-[100px] w-full rounded-lg border border-slate-600 bg-slate-900 p-3 font-mono text-sm tracking-wide"
                    value={pad}
                    readOnly
                  />
                  <div className="flex gap-2">
                    <button onClick={() => copy("pad", pad)} className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm">Copiar pad</button>
                    <button onClick={onExportPad} className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm">Exportar pad (.txt)</button>
                  </div>
                  {copied === "pad" && <span className="text-xs text-green-400">¡Pad copiado!</span>}
                </div>

                <div className="grid gap-2">
                  <label className="block text-sm text-slate-300">Cifrado (resultado)</label>
                  <textarea
                    className="min-h-[100px] w-full rounded-lg border border-slate-600 bg-slate-900 p-3 font-mono text-sm tracking-wide"
                    value={cipher}
                    readOnly
                  />
                  <div className="flex gap-2">
                    <button onClick={() => copy("cipher", cipher)} className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm">Copiar cifrado</button>
                  </div>
                </div>
              </div>
            )}
            <div className={`text-xs ${toneClass}`}>{status.text}</div>
          </section>
        )}

        {/* DESCIFRAR (5 y 6) */}
        {modeScreen === "decrypt" && decryptStep === "ready" && (
          <section className="rounded-2xl border border-slate-700 bg-slate-800/60 p-4 grid gap-4">
            <div className="grid gap-2">
              <label className="block text-sm text-slate-300">Pad / Clave (solo visual)</label>
              <textarea className="min-h-[80px] w-full rounded-lg border border-slate-600 bg-slate-900 p-3 font-mono text-sm" value={pad} readOnly />
            </div>
            <div className="grid gap-2">
              <label className="block text-sm text-slate-300">Texto cifrado</label>
              <textarea
                className="min-h-[120px] w-full rounded-lg border border-slate-600 bg-slate-900 p-3 font-mono text-sm"
                placeholder="Pega aquí el texto cifrado…"
                value={cipher}
                onChange={(e) => setCipher(e.target.value)}
              />
              <div className="flex gap-2">
                <button onClick={onDecrypt} className="px-4 py-2 bg-slate-900 border border-slate-600 rounded-lg font-semibold">Descifrar</button>
                <button onClick={onClearAll} className="px-4 py-2 bg-rose-600 rounded-lg font-semibold">Limpiar</button>
              </div>
            </div>

            {/* Resultado descifrado + contador */}
            {message && (
              <div className="grid gap-2">
                <label className="block text-sm text-slate-300">Mensaje (descifrado)</label>
                <textarea className="min-h-[100px] w-full rounded-lg border border-slate-600 bg-slate-900 p-3 font-mono text-sm" value={message} readOnly />
                {countdown !== null && (
                  <div className="text-xs text-amber-300">
                    El contenido se limpiará en {Math.floor((countdown ?? 0) / 60)}:{String((countdown ?? 0) % 60).padStart(2, "0")} min.
                  </div>
                )}
              </div>
            )}
            <div className={`text-xs ${toneClass}`}>{status.text}</div>
          </section>
        )}
      </div>
    </div>
  );
}
