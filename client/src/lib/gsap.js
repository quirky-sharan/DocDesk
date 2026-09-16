import { useLayoutEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

// One curve for the whole marketing site, matching the app's --ease-out-expo so
// the landing page and the product move the same way.
export const EXPO = 'expo.out';
gsap.defaults({ ease: EXPO, duration: 1 });

export { gsap, ScrollTrigger };

/** True when the visitor has asked their system for less movement. */
export function reduced() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Plays `timeline` the first time `element` comes into view.
 *
 * Deliberately not `scrollTrigger:` inside the tween. A ScrollTrigger owns the
 * animation it is given, and every ScrollTrigger.refresh() - which happens
 * whenever the fonts swap, the 3D canvas settles or the window is resized -
 * reverts that animation to its start values. For a reveal that has already
 * played and whose trigger is now far above the fold, nothing ever re-enters to
 * play it again, so the text stays parked below its mask for good.
 *
 * Creating the trigger separately leaves the timeline ours: a refresh can
 * recalculate positions all it likes and never touches what has already run.
 * `once` then throws the trigger away the moment it has fired.
 */
export function playWhenVisible(element, timeline, start = 'top 85%') {
  if (!element) return null;
  return ScrollTrigger.create({
    trigger: element,
    start,
    once: true,
    onEnter: () => timeline.play(),
  });
}

/**
 * Runs GSAP inside a context scoped to `scope`, so every tween, timeline and
 * ScrollTrigger it creates is reverted together when the component unmounts -
 * no stray triggers left pinning a section that no longer exists.
 *
 * Layout effect, not effect: the setup sets the "from" state, and doing it
 * after paint would show one frame of the finished text before it animates.
 */
export function useGsap(setup, deps = []) {
  const scope = useRef(null);
  useLayoutEffect(() => {
    const context = gsap.context(setup, scope);
    return () => context.revert();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return scope;
}

/**
 * Splits an element's text into per-character spans for staggered reveals.
 *
 * Words stay whole (`white-space: nowrap`) so a reveal can never break a word
 * across lines, and each character sits in an overflow-hidden mask so it can
 * rise into view rather than just fade. The original string is put back on the
 * element as an aria-label and the pieces are hidden from screen readers, so a
 * headline is still read as one sentence.
 */
export function splitChars(element) {
  if (!element) return [];
  // Splitting twice would destroy the first split's spans. React runs layout
  // effects twice in development, so the second call has to hand back what the
  // first one made rather than bail out and leave the text unanimated.
  if (element.dataset.split === 'done') return [...element.querySelectorAll('[data-char]')];

  const text = element.textContent;
  element.setAttribute('aria-label', text);
  element.dataset.split = 'done';
  element.textContent = '';

  const chars = [];
  for (const word of text.split(' ')) {
    const wordSpan = document.createElement('span');
    wordSpan.setAttribute('aria-hidden', 'true');
    wordSpan.style.display = 'inline-block';
    wordSpan.style.whiteSpace = 'nowrap';
    for (const character of word) {
      const mask = document.createElement('span');
      mask.style.display = 'inline-block';
      mask.style.overflow = 'hidden';
      mask.style.verticalAlign = 'top';
      // Display type is set at a line height below 1, so the mask is shorter
      // than the glyphs. Padding pushes the clip edge out past the ascenders
      // and descenders and the matching negative margin puts the layout back,
      // otherwise every p, g and y is cut in half.
      mask.style.padding = '0.16em 0.04em 0.24em';
      mask.style.margin = '-0.16em -0.04em -0.24em';
      const inner = document.createElement('span');
      inner.style.display = 'inline-block';
      inner.style.willChange = 'transform';
      inner.dataset.char = '';
      inner.textContent = character;
      mask.appendChild(inner);
      wordSpan.appendChild(mask);
      chars.push(inner);
    }
    element.appendChild(wordSpan);
    element.appendChild(document.createTextNode(' '));
  }
  return chars;
}

/** The same idea for a block of body copy, one line-mask per line of prose. */
export function splitWords(element) {
  if (!element) return [];
  if (element.dataset.split === 'done') return [...element.querySelectorAll('[data-word]')];

  const text = element.textContent.replace(/\s+/g, ' ').trim();
  element.setAttribute('aria-label', text);
  element.dataset.split = 'done';
  element.textContent = '';

  const words = [];
  for (const word of text.split(' ')) {
    const mask = document.createElement('span');
    mask.setAttribute('aria-hidden', 'true');
    mask.style.display = 'inline-block';
    mask.style.overflow = 'hidden';
    mask.style.verticalAlign = 'top';
    mask.style.padding = '0.08em 0.04em 0.2em';
    mask.style.margin = '-0.08em -0.04em -0.2em';
    const inner = document.createElement('span');
    inner.style.display = 'inline-block';
    inner.dataset.word = '';
    inner.textContent = word;
    mask.appendChild(inner);
    element.appendChild(mask);
    element.appendChild(document.createTextNode(' '));
    words.push(inner);
  }
  return words;
}
