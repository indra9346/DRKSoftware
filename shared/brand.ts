// The gym this install is for. To rebrand, change these values and the images in
// client/public/brand/ (logo on a transparent background, a print version, the emblem).
export const BRAND = {
  name: "DRK Fitness Gym",
  shortName: "DRK FITNESS",
  tagline: "Stronger · Healthier · Happier",
  /** Prefix of new member codes (DRK-AB12CD34) and receipt numbers (DRK-202610-000001). */
  codePrefix: "DRK",
  /** Member QR badges read "DRK|<member code>". */
  qrPrefix: "DRK",
  logo: "/brand/drk-logo.png",
  printLogo: "/brand/drk-logo-print.png",
  mark: "/brand/drk-mark.png",
} as const;

/** QR badge prefixes, including badges printed under the earlier Fit Crush and Swan names. */
export const QR_PREFIX_PATTERN = /^(DRK|FITCRUSH|SWAN)[|:]/;
