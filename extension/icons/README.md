# DIGIGAMI Guardian Icons

## Generating PNG Icons

The extension requires PNG icons at the following sizes:
- `digigami-16.png` (16x16)
- `digigami-32.png` (32x32)
- `digigami-48.png` (48x48)
- `digigami-128.png` (128x128)

### Option 1: Use the Icon Generator

Open `generate-icons.html` in a browser to generate and download PNG icons from the SVG source.

### Option 2: Command Line (with ImageMagick)

```bash
# Install ImageMagick if not already installed
# Windows: choco install imagemagick
# Mac: brew install imagemagick
# Linux: sudo apt install imagemagick

# Generate PNGs from SVG
convert icon.svg -resize 16x16 digigami-16.png
convert icon.svg -resize 32x32 digigami-32.png
convert icon.svg -resize 48x48 digigami-48.png
convert icon.svg -resize 128x128 digigami-128.png
```

### Option 3: Online Tools

1. Go to https://cloudconvert.com/svg-to-png
2. Upload `icon.svg`
3. Set the desired size
4. Download the PNG

## Icon Design

The DIGIGAMI Guardian icon features:
- Dark gradient background (#1a1a2e to #0f0f19)
- Indigo outer ring (#818cf8)
- Purple core gradient (#6366f1 to #4f46e5)
- White center dot representing the digital twin
