import { ReactNode, useEffect, useRef } from "react";
// @ts-ignore — JS module
import { autoTranslate, useT } from "@/data/i18n";

/**
 * GlobalAutoTranslate — translates every visible text node under #root
 * to the active language, falling back to English when no translation
 * is available.
 *
 * Why: hand-wrapping every <span> with `t()` or `<AutoT>` doesn't scale
 * across hundreds of strings, and any miss leaves an English word in
 * the middle of a Swahili screen. This walks the DOM after each
 * render, posts unique English phrases to the existing translation
 * chain (Google gtx → MyMemory → Argos), and writes the result back
 * into `node.nodeValue`. The original text is kept in a WeakMap so we
 * can flip back to English without rebuilding the tree.
 *
 * The provider does nothing when `lang === 'en'` — original strings
 * are already correct, and React owns the DOM in that case.
 */

const SKIP_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "TEXTAREA",
  "CODE",
  "PRE",
]);
// Authors can opt a subtree out by adding data-no-translate.
const NO_TRANSLATE_ATTR = "data-no-translate";

// Pure-symbol / pure-numeric strings should never be sent to the
// translation API — they cost a round-trip and come back unchanged.
const isUntranslatable = (text: string) => {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length < 2) return true;
  // Numbers, currency tags, ticker symbols, dates.
  return /^[\s\d.,:;!?\-—–_/\\|·•()[\]{}+%@#&*=<>$£€¥]+$|^TZS\s|^USD\s|^EUR\s|^GBP\s/.test(trimmed);
};

const shouldVisit = (parent: HTMLElement | null) => {
  if (!parent) return false;
  if (SKIP_TAGS.has(parent.tagName)) return false;
  if (parent.closest(`[${NO_TRANSLATE_ATTR}]`)) return false;
  if (parent.isContentEditable) return false;
  return true;
};

export const GlobalAutoTranslate = ({ children }: { children: ReactNode }) => {
  const { lang } = useT();
  // Original English text, keyed by Text node. Required so we can
  // restore exactly what React rendered when the user flips back.
  const originals = useRef<WeakMap<Text, string>>(new WeakMap());
  // The translated string we wrote into the node, so we can ignore
  // the MutationObserver event our own write produced.
  const written = useRef<WeakMap<Text, string>>(new WeakMap());

  useEffect(() => {
    const root = document.getElementById("root") || document.body;
    if (!root) return;

    // English path: restore every node we previously rewrote, then
    // detach. We don't want React's reconciliation racing with us.
    if (lang === "en") {
      const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = tw.nextNode())) {
        const t = node as Text;
        const orig = originals.current.get(t);
        if (orig != null && t.nodeValue !== orig) {
          written.current.set(t, orig);
          t.nodeValue = orig;
        }
      }
      return;
    }

    // Swahili (or any future locale) path: translate-and-replace.
    const translateNode = (textNode: Text) => {
      const parent = textNode.parentElement;
      if (!shouldVisit(parent)) return;

      const current = textNode.nodeValue || "";
      // If our own write triggered the mutation, skip.
      if (written.current.get(textNode) === current) return;

      // Lock in the English original on first sight. Any later writes
      // by React will reset .nodeValue to a new English value, in
      // which case we re-record and re-translate.
      let orig = originals.current.get(textNode);
      if (orig == null || (current && current !== written.current.get(textNode))) {
        orig = current;
        originals.current.set(textNode, current);
      }
      const text = orig.trim();
      if (isUntranslatable(text)) return;

      autoTranslate(text, lang).then((out: string) => {
        if (!out || typeof out !== "string") return;
        // Preserve the leading / trailing whitespace pattern of the
        // original so adjacent inline elements still spaces correctly.
        const leading = orig!.match(/^\s*/)?.[0] || "";
        const trailing = orig!.match(/\s*$/)?.[0] || "";
        const next = `${leading}${out.trim()}${trailing}`;
        if (textNode.nodeValue !== next) {
          written.current.set(textNode, next);
          textNode.nodeValue = next;
        }
      }).catch(() => {
        /* network noise; original English stays */
      });
    };

    const visitSubtree = (rootNode: Node) => {
      if (rootNode.nodeType === Node.TEXT_NODE) {
        translateNode(rootNode as Text);
        return;
      }
      if (rootNode.nodeType !== Node.ELEMENT_NODE) return;
      const tw = document.createTreeWalker(
        rootNode,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode: (n) =>
            shouldVisit((n as Text).parentElement)
              ? NodeFilter.FILTER_ACCEPT
              : NodeFilter.FILTER_REJECT,
        }
      );
      let n: Node | null;
      while ((n = tw.nextNode())) translateNode(n as Text);
    };

    // Initial sweep.
    visitSubtree(root);

    // React replaces / mutates text nodes whenever a component re-renders
    // with a different string. Catch them all via MutationObserver so
    // route transitions, lazy data, and toast messages all get translated.
    const obs = new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === "characterData") {
          translateNode(m.target as Text);
        } else if (m.type === "childList") {
          m.addedNodes.forEach((n) => visitSubtree(n));
        }
      }
    });
    obs.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    return () => obs.disconnect();
  }, [lang]);

  return <>{children}</>;
};
