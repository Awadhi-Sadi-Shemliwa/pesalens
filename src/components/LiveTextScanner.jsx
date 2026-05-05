import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { canvasToFile, parseReceiptText } from '../data/api';

// Tesseract is heavy (~2 MB worker + traineddata). Lazy-load it the first time
// the user opens Live Text mode so the rest of the PWA stays snappy.
let tesseractPromise = null;
const loadTesseract = () => {
  if (!tesseractPromise) tesseractPromise = import('tesseract.js');
  return tesseractPromise;
};

const SCAN_INTERVAL_MS = 900;

const LiveTextScanner = ({ open, onClose, onCapture, onTextResult, busy = false }) => {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const overlayRef = useRef(null);
  const workerRef = useRef(null);
  const intervalRef = useRef(null);
  const closingRef = useRef(false);

  const [mode, setMode] = useState('smart'); // 'smart' | 'live'
  const [stream, setStream] = useState(null);
  const [words, setWords] = useState([]); // [{text, bbox:{x0,y0,x1,y1}}]
  const [selected, setSelected] = useState([]); // array of words
  const [ocrReady, setOcrReady] = useState(false);
  const [ocrError, setOcrError] = useState(null);
  const [refining, setRefining] = useState(false);
  const [refined, setRefined] = useState(null);
  const [contrastBoost, setContrastBoost] = useState(true);
  const [textMode, setTextMode] = useState(false); // Smart Scan via Tesseract + MiniMax
  const [textBusy, setTextBusy] = useState(false);
  const [videoSize, setVideoSize] = useState({ w: 0, h: 0 });

  const stopCamera = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      setStream(null);
    }
    setWords([]);
  }, [stream]);

  const handleClose = useCallback(() => {
    closingRef.current = true;
    stopCamera();
    setSelected([]);
    setRefined(null);
    setOcrError(null);
    onClose?.();
  }, [stopCamera, onClose]);

  // Open camera when modal opens
  useEffect(() => {
    if (!open) return undefined;
    closingRef.current = false;

    const start = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          setOcrError('Camera API is not available in this browser.');
          return;
        }
        const media = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        if (closingRef.current) {
          media.getTracks().forEach((t) => t.stop());
          return;
        }
        setStream(media);
      } catch (err) {
        setOcrError(err?.message || 'Could not access camera.');
      }
    };

    start();
    return () => {
      closingRef.current = true;
      stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Bind stream to <video> when both are ready
  useEffect(() => {
    if (!stream || !videoRef.current) return;
    videoRef.current.srcObject = stream;
    const onLoaded = () => {
      const v = videoRef.current;
      if (v) setVideoSize({ w: v.videoWidth, h: v.videoHeight });
    };
    videoRef.current.addEventListener('loadedmetadata', onLoaded);
    return () => videoRef.current?.removeEventListener('loadedmetadata', onLoaded);
  }, [stream]);

  // Spin up Tesseract worker only in Live mode
  useEffect(() => {
    if (!open || mode !== 'live') return undefined;
    let cancelled = false;

    const init = async () => {
      try {
        const Tesseract = await loadTesseract();
        if (cancelled) return;
        const worker = await Tesseract.createWorker('eng', 1, {
          // logger: (m) => console.log(m),
        });
        if (cancelled) {
          await worker.terminate();
          return;
        }
        workerRef.current = worker;
        setOcrReady(true);
      } catch (err) {
        setOcrError('Failed to load OCR engine: ' + (err?.message || 'unknown'));
      }
    };

    init();
    return () => {
      cancelled = true;
      if (workerRef.current) {
        const w = workerRef.current;
        workerRef.current = null;
        setOcrReady(false);
        w.terminate().catch(() => {});
      }
    };
  }, [open, mode]);

  // Periodic snapshot + OCR while in Live mode
  useEffect(() => {
    if (!open || mode !== 'live' || !ocrReady || !stream) return undefined;

    let inFlight = false;
    intervalRef.current = setInterval(async () => {
      if (inFlight || !workerRef.current || !videoRef.current || !canvasRef.current) return;
      const v = videoRef.current;
      if (!v.videoWidth) return;
      inFlight = true;

      const canvas = canvasRef.current;
      canvas.width = v.videoWidth;
      canvas.height = v.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(v, 0, 0, canvas.width, canvas.height);

      if (contrastBoost) {
        // Cheap contrast/threshold pass to help faded EFD thermal receipts
        try {
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const d = img.data;
          for (let i = 0; i < d.length; i += 4) {
            const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
            const v2 = gray > 140 ? 255 : gray < 90 ? 0 : gray;
            d[i] = d[i + 1] = d[i + 2] = v2;
          }
          ctx.putImageData(img, 0, 0);
        } catch {
          // tainted canvas etc — ignore
        }
      }

      try {
        const { data } = await workerRef.current.recognize(canvas);
        const w = (data?.words || [])
          .filter((it) => it.text && it.text.trim() && it.confidence > 50)
          .map((it) => ({ text: it.text.trim(), bbox: it.bbox }));
        setWords(w);
      } catch {
        // transient OCR errors are fine — try again next tick
      } finally {
        inFlight = false;
      }
    }, SCAN_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [open, mode, ocrReady, stream, contrastBoost]);

  const captureSmart = async () => {
    if (!videoRef.current || !canvasRef.current) return;
    const v = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    canvas.getContext('2d').drawImage(v, 0, 0, canvas.width, canvas.height);

    // Vision-model path: hand the image file to the parent for /receipts/scan
    if (!textMode) {
      const file = await canvasToFile(canvas, `receipt-${Date.now()}.jpg`);
      onCapture?.(file);
      return;
    }

    // Text path: Tesseract OCR locally, then ship the string to MiniMax
    setTextBusy(true);
    setOcrError(null);
    try {
      const Tesseract = await loadTesseract();
      let worker = workerRef.current;
      let owned = false;
      if (!worker) {
        worker = await Tesseract.createWorker('eng', 1);
        owned = true;
      }
      const { data } = await worker.recognize(canvas);
      if (owned) await worker.terminate();
      const text = (data?.text || '').trim();
      if (!text) {
        setOcrError('No text detected. Hold steadier and try again.');
        return;
      }
      const parsed = await parseReceiptText(text, { save: true });
      onTextResult?.(parsed);
    } catch (err) {
      setOcrError(err?.message || 'Text scan failed');
    } finally {
      setTextBusy(false);
    }
  };

  const toggleWord = (word) => {
    setSelected((prev) => {
      const exists = prev.some((p) => p.bbox.x0 === word.bbox.x0 && p.bbox.y0 === word.bbox.y0);
      return exists
        ? prev.filter((p) => !(p.bbox.x0 === word.bbox.x0 && p.bbox.y0 === word.bbox.y0))
        : [...prev, word];
    });
  };

  const selectAll = () => setSelected(words);
  const clearSelection = () => setSelected([]);

  const sendSnippetToLLM = async () => {
    if (!selected.length) return;
    setRefining(true);
    setRefined(null);
    try {
      const text = selected.map((w) => w.text).join(' ');
      const data = await parseReceiptText(text, { save: false });
      setRefined(data);
    } catch (err) {
      setRefined({ error: err.message || 'LLM call failed' });
    } finally {
      setRefining(false);
    }
  };

  if (!open) return null;

  // Map OCR coordinates (canvas pixels) to overlay element pixels
  const overlay = overlayRef.current;
  const scaleX = overlay && videoSize.w ? overlay.clientWidth / videoSize.w : 1;
  const scaleY = overlay && videoSize.h ? overlay.clientHeight / videoSize.h : 1;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/95">
      <div className="flex items-center justify-between p-4 border-b border-white/10 text-white">
        <div className="flex items-center gap-3">
          <Icon name="camera" size={18} />
          <h3 className="font-semibold text-sm">Camera Scan</h3>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex bg-white/5 border border-white/10 rounded-lg p-1">
            <button
              onClick={() => setMode('smart')}
              className={`px-3 py-1 rounded-md text-xs font-medium transition ${
                mode === 'smart' ? 'bg-white/15 text-white' : 'text-white/60 hover:text-white'
              }`}
            >
              Smart Scan
            </button>
            <button
              onClick={() => setMode('live')}
              className={`px-3 py-1 rounded-md text-xs font-medium transition ${
                mode === 'live' ? 'bg-white/15 text-white' : 'text-white/60 hover:text-white'
              }`}
            >
              Live Text
            </button>
          </div>
          <button onClick={handleClose} className="p-2 rounded-lg hover:bg-white/10">
            <Icon name="x" size={18} className="text-white" />
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        <div className="relative flex-1 flex items-center justify-center bg-black overflow-hidden">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="max-h-full max-w-full"
            style={{ transform: 'scaleX(1)' }}
          />
          {/* Hidden working canvas — used for snapshots and OCR */}
          <canvas ref={canvasRef} className="hidden" />

          {/* Overlay positioned exactly over the visible <video> */}
          {videoSize.w > 0 && (
            <div
              ref={overlayRef}
              className="absolute inset-0 pointer-events-none flex items-center justify-center"
            >
              <div
                className="relative pointer-events-auto"
                style={{
                  width: '100%',
                  height: '100%',
                }}
              >
                {mode === 'live' &&
                  words.map((w, i) => {
                    const x = w.bbox.x0 * scaleX;
                    const y = w.bbox.y0 * scaleY;
                    const width = (w.bbox.x1 - w.bbox.x0) * scaleX;
                    const height = (w.bbox.y1 - w.bbox.y0) * scaleY;
                    const isSelected = selected.some(
                      (s) => s.bbox.x0 === w.bbox.x0 && s.bbox.y0 === w.bbox.y0,
                    );
                    return (
                      <button
                        key={`${i}-${w.bbox.x0}-${w.bbox.y0}`}
                        onClick={() => toggleWord(w)}
                        title={w.text}
                        className={`absolute rounded-sm transition ${
                          isSelected
                            ? 'bg-blue-500/40 border border-blue-300'
                            : 'bg-blue-400/15 border border-blue-300/40 hover:bg-blue-400/30'
                        }`}
                        style={{ left: x, top: y, width, height }}
                      />
                    );
                  })}
              </div>
            </div>
          )}

          {/* Reticle / framing guide */}
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
            <div className="border-2 border-white/30 rounded-2xl" style={{ width: '85%', height: '70%' }} />
          </div>

          {/* Status pill */}
          <div className="absolute top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-black/60 text-white text-[11px] font-medium">
            {mode === 'live'
              ? ocrError
                ? ocrError
                : ocrReady
                ? `Live · ${words.length} words detected`
                : 'Loading OCR engine…'
              : busy
              ? 'Sending to vision model…'
              : 'Frame the receipt and tap Capture'}
          </div>
        </div>

        {/* Side / bottom action panel */}
        <div className="w-full lg:w-80 lg:border-l border-t lg:border-t-0 border-white/10 bg-black/70 text-white p-4 overflow-auto">
          {mode === 'smart' ? (
            <div className="space-y-3">
              <h4 className="font-semibold text-sm">Smart Scan</h4>
              <p className="text-xs text-white/60 leading-relaxed">
                {textMode
                  ? 'Tesseract reads the receipt locally, then MiniMax extracts vendor, total, date, and line items.'
                  : 'Sends the image straight to a vision model to extract vendor, total, date, and line items.'}
              </p>
              <button
                onClick={captureSmart}
                disabled={!stream || busy || textBusy}
                className="w-full py-3 rounded-xl bg-white text-black font-semibold text-sm disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <Icon name="camera" size={16} />
                {textBusy
                  ? 'OCR + MiniMax…'
                  : busy
                  ? 'Processing…'
                  : textMode
                  ? 'Capture (OCR + MiniMax)'
                  : 'Capture & Extract'}
              </button>
              <label className="flex items-center gap-2 text-xs text-white/70">
                <input
                  type="checkbox"
                  checked={textMode}
                  onChange={(e) => setTextMode(e.target.checked)}
                />
                Use OCR + text model (works with MiniMax)
              </label>
              <label className="flex items-center gap-2 text-xs text-white/70">
                <input
                  type="checkbox"
                  checked={contrastBoost}
                  onChange={(e) => setContrastBoost(e.target.checked)}
                />
                Boost contrast (helps faded EFD receipts)
              </label>
              {ocrError && (
                <div className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded p-2">
                  {ocrError}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-semibold text-sm">Live Text</h4>
                <div className="flex gap-1">
                  <button onClick={selectAll} className="text-[11px] px-2 py-1 rounded bg-white/10 hover:bg-white/20">
                    Select all
                  </button>
                  <button onClick={clearSelection} className="text-[11px] px-2 py-1 rounded bg-white/10 hover:bg-white/20">
                    Clear
                  </button>
                </div>
              </div>
              <p className="text-xs text-white/60 leading-relaxed">
                Tap any blue box to grab that word. Stack words to build an amount or vendor name, then send
                the snippet to the assistant.
              </p>
              <div className="bg-white/5 border border-white/10 rounded-lg p-3 min-h-[64px] text-sm break-words">
                {selected.length ? selected.map((w) => w.text).join(' ') : (
                  <span className="text-white/40 text-xs">No text selected yet.</span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={sendSnippetToLLM}
                  disabled={!selected.length || refining}
                  className="py-2 rounded-lg bg-blue-500 hover:bg-blue-400 text-white text-xs font-semibold disabled:opacity-40"
                >
                  {refining ? 'Asking AI…' : 'Refine with AI'}
                </button>
                <button
                  onClick={captureSmart}
                  disabled={!stream || busy}
                  className="py-2 rounded-lg bg-white text-black text-xs font-semibold disabled:opacity-40"
                >
                  Full Smart Scan
                </button>
              </div>
              {refined && (
                <pre className="bg-black/50 border border-white/10 rounded-lg p-3 text-[11px] whitespace-pre-wrap break-words text-white/90">
                  {JSON.stringify(refined, null, 2)}
                </pre>
              )}
              <label className="flex items-center gap-2 text-xs text-white/70">
                <input
                  type="checkbox"
                  checked={contrastBoost}
                  onChange={(e) => setContrastBoost(e.target.checked)}
                />
                Boost contrast (helps faded EFD receipts)
              </label>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default LiveTextScanner;
