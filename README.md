# Dither Playground

Interactive particle art experiment inspired by [Emil Kowalski's](https://x.com/emilkowalski) dithered logo interaction for Linear.

An image (avatar.png) is sampled into thousands of tiny colored dots that form a pointillist painting. The dots respond to cursor/touch interaction with spring physics.

## Features

- **Colorful pointillist rendering** — image pixels sampled as colored dots, not B&W dithering
- **Spring physics** — dots snap back to their target positions with satisfying overshoot
- **Cursor repulsion** — invisible circle around cursor pushes dots with cubic falloff
- **Expanding ripple on click** — shockwave ring propagates outward from click point
- **Mobile/touch support** — drag to repel, tap for ripple
- **Real-time Dither Tool** — slider panel to tweak dot count, radius, contrast, physics constants
- **Idle drift** — subtle sine/cosine wobble keeps the image alive

## Tech

- Next.js 14 (App Router)
- TypeScript
- HTML Canvas + requestAnimationFrame
- Float32Array particle system
- No animation libraries — pure math

## Inspired by

- [Emil Kowalski's tweet](https://x.com/emilkowalski/status/2036778116748542220) about Linear's dithered logo
- [Sean Brydon's SVG particle morphing tutorial](https://www.brydon.io/blog/svg-particle-morphing)

## Run locally

```bash
npm install
npm run dev
```

Put your image as `public/avatar.png` and open http://localhost:3000
