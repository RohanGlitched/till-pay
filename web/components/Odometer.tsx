"use client";

import styles from "./Odometer.module.css";

/**
 * Rolls each digit on its own wheel, like a meter. Wheels are keyed from the right so the cents
 * keep turning while new digits appear on the left. With reduced motion the digits just change.
 */
export function Odometer({ value, label }: { value: string; label?: string }) {
  const chars = [...value];
  return (
    <span className={styles.odo} aria-label={label ?? value} role="img">
      {chars.map((ch, i) => {
        const key = chars.length - i;
        if (ch >= "0" && ch <= "9") {
          const d = ch.charCodeAt(0) - 48;
          return (
            <span key={key} className={styles.wheel} aria-hidden>
              <span className={styles.strip} style={{ transform: `translateY(${-d * 10}%)` }}>
                {"0123456789".split("").map((n) => (
                  <span key={n}>{n}</span>
                ))}
              </span>
            </span>
          );
        }
        return (
          <span key={key} className={styles.glyph} aria-hidden>
            {ch}
          </span>
        );
      })}
    </span>
  );
}
