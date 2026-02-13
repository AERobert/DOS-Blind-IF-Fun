Accessible DOS Text Adventure Player
=====================================

A browser-based DOS emulator with screen reader accessibility for
playing classic text adventures. Uses v86 (x86 emulator) + FreeDOS
+ Web Speech API.

QUICK START
-----------
1. Double-click start.command (macOS) to launch the local web server.
   Or serve this folder via any HTTP server (e.g., python3 -m http.server 8000).
2. Open dos-adventure-player.html in your browser.
3. Select a game from the dropdown and press "Boot & Launch Game".

INCLUDED GAMES
--------------
* T-Zero (1991) — Infocom-style text adventure by Dennis Drew
  Disk type: Floppy (B:) | Autorun: T-ZERO.EXE

* Mindwheel (1984) — Interactive fiction by Robert Pinsky
  Disk type: Floppy (B:) | Autorun: MNDWHEEL.BAT

* Time Quest (1991) — Graphical text adventure by Legend Entertainment
  Disk type: Hard disk (C:) | Autorun: TQ.EXE
  Note: This game uses EGA/VGA graphics. Text responses may need
  the "below last prompt" response extraction mode.

* Eamon Deluxe 5.0 — Collection of 25 text adventures
  Disk type: Hard disk (C:) | Autorun: EAMONDX.BAT
  Runs via a custom QBasic interpreter (EDX_50.EXE).

DISK TYPES
----------
Games can use two disk formats:
  Floppy (FAT12, up to 1.44MB): mounted as B: drive
  Hard disk (FAT16, 16MB+):     mounted as C: drive

The disk type is auto-selected when choosing a known game.
Custom .img files can be loaded at runtime with either type.

CREATING NEW DISK IMAGES
-------------------------
For floppy (up to 1.44MB of files):
  dd if=/dev/zero of=game.img bs=512 count=2880
  mkfs.vfat -F 12 -n "GAMENAME" game.img
  mcopy -i game.img GAME.EXE ::GAME.EXE

For hard disk (larger games):
  dd if=/dev/zero of=game.img bs=1M count=16   # or 32, 64, etc.
  mkfs.vfat -F 16 -n "GAMENAME" -I game.img
  mcopy -i game.img GAME.EXE ::GAME.EXE
  mmd -i game.img ::SUBDIR                     # create directories
  mcopy -i game.img file.dat ::SUBDIR/file.dat  # copy into subdirs

ACCESSIBILITY FEATURES
----------------------
* Web Speech API with configurable voice, rate, pitch
* VI-like read mode (j/k/h/l/w/b/g/G/$/^/0)
* Typing feedback (characters or words)
* Command history with speech
* F-key shortcuts for all major actions
* Configurable game prompt detection
* Transcript recording
* Collapsible UI sections with heading navigation

FILES
-----
dos-adventure-player.html  Main application (single HTML file)
start.command              macOS launcher script
freedos722.img             FreeDOS boot floppy
libv86.js + v86.wasm       v86 x86 emulator engine
seabios.bin + vgabios.bin  PC BIOS firmware images
tzero-data.img             T-Zero game disk (floppy)
mindwheel.img              Mindwheel game disk (floppy)
timequest.img              Time Quest game disk (hard disk)
eamondx.img                Eamon Deluxe game disk (hard disk)
