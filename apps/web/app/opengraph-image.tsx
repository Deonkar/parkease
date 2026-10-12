import { webColors } from '@parkease/tokens';
import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt =
  'ParkEase. Stop circling the block. A row of parking bays at night with one bay lit green as free.';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const BAYS = 10;
const FREE_BAY = 5;
const DISPLAY = 'Big Shoulders';

/** The share image: the headline over the basement floor, one bay lit as free. */
export default async function OpengraphImage() {
  const font = await fetch(new URL('../assets/BigShoulders-Black.ttf', import.meta.url)).then(
    (res) => res.arrayBuffer(),
  );

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          position: 'relative',
          background: webColors.midnight,
          color: webColors.onMidnight,
          fontFamily: DISPLAY,
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: 72,
            top: 60,
            display: 'flex',
            alignItems: 'center',
            gap: 16,
          }}
        >
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 11,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: webColors.primary,
              color: webColors.onPrimary,
              boxShadow: `inset 0 0 0 3px ${webColors.onPrimary}`,
              fontSize: 42,
            }}
          >
            P
          </div>
          <div style={{ fontSize: 46 }}>ParkEase</div>
        </div>
        <div
          style={{
            position: 'absolute',
            right: 72,
            top: 72,
            fontSize: 30,
            color: webColors.onMidnightMuted,
          }}
        >
          parkease.in
        </div>
        <div
          style={{
            position: 'absolute',
            left: 72,
            top: 150,
            display: 'flex',
            flexDirection: 'column',
            fontSize: 132,
            lineHeight: 0.86,
          }}
        >
          <div>Stop circling</div>
          <div>the block.</div>
        </div>
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: 190,
            display: 'flex',
            justifyContent: 'center',
            background: webColors.floor,
            borderTop: `1px solid ${webColors.midnightRule}`,
          }}
        >
          {Array.from({ length: BAYS }, (_, i) => {
            const free = i === FREE_BAY;
            return (
              <div
                key={i}
                style={{
                  width: 120,
                  height: 190,
                  position: 'relative',
                  display: 'flex',
                  borderLeft: `4px solid ${webColors.floorPaint}`,
                  // Satori rejects undefined style values, so the last bay's line is always set.
                  borderRight: `4px solid ${i === BAYS - 1 ? webColors.floorPaint : 'transparent'}`,
                }}
              >
                {free ? (
                  <div
                    style={{
                      position: 'absolute',
                      left: 10,
                      right: 10,
                      top: 36,
                      height: 86,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: 4,
                      background: webColors.freeLitFill,
                      border: `3px solid ${webColors.freeLit}`,
                      color: webColors.freeLit,
                      fontSize: 42,
                    }}
                  >
                    FREE
                  </div>
                ) : (
                  <div
                    style={{
                      position: 'absolute',
                      left: 22,
                      right: 22,
                      top: 20,
                      height: 140,
                      borderRadius: 20,
                      background: webColors.carShades[i % webColors.carShades.length],
                    }}
                  />
                )}
                <div
                  style={{
                    position: 'absolute',
                    bottom: 2,
                    left: 0,
                    right: 0,
                    display: 'flex',
                    justifyContent: 'center',
                    fontSize: 28,
                    color: webColors.floorStencil,
                  }}
                >
                  {String(11 + i)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    ),
    { ...size, fonts: [{ name: DISPLAY, data: font, weight: 900 }] },
  );
}
