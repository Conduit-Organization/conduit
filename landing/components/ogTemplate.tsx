import { ImageResponse } from "next/og";

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_CONTENT_TYPE = "image/png";
export const OG_ALT = "Conduit — a serverless, peer-to-peer marketplace for AI inference";

const MARK =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1000 1000'><path d='M736.4,315.3 A300,300 0 1 0 736.4,684.7' stroke='#2be3a8' stroke-width='86' stroke-linecap='round' fill='none'/><circle cx='800' cy='500' r='44' fill='#2be3a8'/></svg>`,
  );

/** Best-effort load of Instrument Serif (ttf) for the headline; null on failure. */
async function loadDisplayFont(): Promise<ArrayBuffer | null> {
  try {
    const cssRes = await fetch(
      "https://fonts.googleapis.com/css2?family=Instrument+Serif&display=swap",
    );
    if (!cssRes.ok) return null;
    const css = await cssRes.text();
    const url =
      css.match(/url\((https:\/\/[^)]+\.(?:ttf|otf))\)/)?.[1] ??
      css.match(/url\((https:\/\/[^)]+)\)/)?.[1];
    if (!url) return null;
    const fontRes = await fetch(url);
    if (!fontRes.ok) return null;
    return await fontRes.arrayBuffer();
  } catch {
    return null;
  }
}

export async function renderOgImage() {
  const fontData = await loadDisplayFont();
  const display = fontData ? "Instrument Serif" : "serif";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 80px",
          color: "#e7f0ef",
          fontFamily: "sans-serif",
          background: "#0a0e13",
          backgroundImage:
            "radial-gradient(900px 520px at 82% -12%, rgba(43,227,168,0.20), transparent 60%), radial-gradient(700px 600px at -8% 118%, rgba(43,227,168,0.10), transparent 55%)",
        }}
      >
        {/* top row */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={MARK} width={62} height={62} alt="" />
            <span style={{ fontFamily: display, fontSize: 44 }}>Conduit</span>
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 22,
              color: "#2be3a8",
              border: "1px solid rgba(43,227,168,0.34)",
              background: "rgba(43,227,168,0.12)",
              borderRadius: 999,
              padding: "8px 20px",
              letterSpacing: 1,
            }}
          >
            Public testnet · v0.1.0
          </div>
        </div>

        {/* headline */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontFamily: display, fontSize: 86, lineHeight: 1.04 }}>
            Buy AI answers from{" "}
            <span style={{ color: "#2be3a8", fontStyle: "italic", marginLeft: 18 }}>peers.</span>
          </div>
          <div style={{ display: "flex", fontFamily: display, fontSize: 86, lineHeight: 1.04 }}>
            Pay per answer.
          </div>
          <div style={{ display: "flex", marginTop: 26, fontSize: 28, color: "#8a9aa6", maxWidth: 940 }}>
            A serverless, peer-to-peer marketplace for AI inference. Pay a fraction of a cent in USDT —
            or run a model and earn.
          </div>
        </div>

        {/* bottom row */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 26,
            fontSize: 22,
            color: "#5c6b76",
          }}
        >
          <span style={{ display: "flex" }}>No cloud</span>
          <span style={{ display: "flex", color: "#2be3a8" }}>·</span>
          <span style={{ display: "flex" }}>No account</span>
          <span style={{ display: "flex", color: "#2be3a8" }}>·</span>
          <span style={{ display: "flex" }}>Keys stay on your device</span>
          <span style={{ display: "flex", color: "#2be3a8" }}>·</span>
          <span style={{ display: "flex" }}>Open source</span>
        </div>
      </div>
    ),
    {
      ...OG_SIZE,
      fonts: fontData
        ? [{ name: "Instrument Serif", data: fontData, weight: 400, style: "normal" }]
        : [],
    },
  );
}
