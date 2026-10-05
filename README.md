# Fieldwork — Applied Math Lab

A practical, visual refresher for the mathematics behind **fluid simulation and rendering**. The course is designed for someone who remembers the physics and ideas but wants to rebuild fluency with the equations.

## Run it locally

This is a dependency-free static site. From the project directory, run:

```bash
python3 -m http.server 8000 --bind 0.0.0.0
```

Then open `http://localhost:8000`.

## Course map

1. **Rebuild the toolkit** — notation and units, derivatives, gradients, and integrals.
2. **Read a field** — divergence, curl, Gauss’s theorem, and Stokes’ theorem.
3. **Make a fluid** — advection, Navier–Stokes, pressure projection, grids, and CFL.
4. **Render light** — Maxwell’s equations, electromagnetic waves, the rendering equation, and volume ray marching.

Lessons combine intuition, symbol-by-symbol equation reading, worked examples, paper-reading cues, a short check-your-understanding quiz, and interactive experiments. Completion progress is saved in the browser’s local storage.

## Files

- `index.html` — application shell and formula-reading guide
- `styles.css` and `dark-theme.css` — responsive interface and dark palette
- `app.js` — lesson content, navigation, progress, quizzes, and canvas experiments
