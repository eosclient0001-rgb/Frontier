const units = [
  {
    title: 'Rebuild the toolkit',
    shortTitle: 'Rebuild the toolkit',
    description: 'Get comfortable with notation, change, and accumulation again.',
    lessons: [
      {
        id: 'notation', title: 'Treat an equation as a sentence', duration: '8 min',
        deck: 'A research-paper equation is a compressed explanation, not a memory test. Start by asking what each symbol is doing.',
        aim: 'Translate a formula into quantities, units, and a plain-language sentence before trying to calculate with it.',
        intuitionTitle: 'Symbols are labels for things that change.',
        intuition: 'In simulation, most quantities are functions of <strong>where</strong> you are and <strong>when</strong> you look. A symbol like <em>q(x, t)</em> is not one mysterious number: it is a rule that returns a value for each position and time.',
        analogy: 'Read the parentheses as an address. “At this location, at this moment, what is the value?” Once you know the address and the units, the equation is already less abstract.',
        formula: 'q = q(x, t)', formulaTag: 'a field is a quantity with an address',
        formulaNote: 'The same idea works for a scalar field (one value per point) and a vector field (a direction and magnitude per point).',
        symbols: [
          { token: 'q', text: 'A quantity being tracked: density, temperature, dye, or pressure.' },
          { token: 'x', text: 'Position. In 3D, x is shorthand for (x, y, z), measured in metres.' },
          { token: 't', text: 'Time, measured in seconds.' },
          { token: 'u(x,t)', text: 'Velocity at a place and time; a vector in metres per second.' }
        ],
        workedHeading: 'A tiny translation',
        worked: 'If u(2 m, 3 s) = (1, 0, 0) m/s, then at x = 2 m and t = 3 s the fluid moves one metre per second in the positive x direction. The units tell you this is a velocity, not a position.',
        workedMath: 'input: (position, time)\noutput: velocity vector',
        paperBridge: 'When a paper introduces a field, write “input → output” in the margin. Then note the units. You have decoded the function before touching the operators.',
        challenge: 'A temperature field T(x,t) returns one number at every point. Is T a scalar field or a vector field?',
        challengeAnswer: 'A scalar field: temperature has a magnitude at each point but no direction. Its units might be kelvin or degrees Celsius.',
        quiz: {
          question: 'The notation u(x,t) most naturally means…',
          options: ['A velocity vector that can vary with position and time.', 'One fixed speed, independent of location.', 'The acceleration of a particle at every point.'], correct: 0,
          explanation: 'The arguments x and t say where and when to evaluate u. In fluid mechanics u is usually the velocity vector field.'
        }
      },
      {
        id: 'derivative', title: 'Derivatives: measure change right here', duration: '12 min',
        deck: 'A derivative is the local rate of change. It is the number that tells you how steeply a quantity is changing at one point.',
        aim: 'Connect a derivative to slope, units, and a finite-difference estimate you can compute on a grid.',
        intuitionTitle: 'Zoom in until a curve looks like a line.',
        intuition: 'Over a small interval, change divided by distance gives an average slope. Shrink that interval around the point and the average approaches the <strong>instantaneous slope</strong>. That limiting slope is the derivative.',
        analogy: 'A speedometer does not report your average trip speed; it estimates how fast your position is changing right now. A derivative is that same “right now” idea for any quantity.',
        formula: 'df/dx = limₕ→₀ [f(x + h) − f(x)] / h\n≈ [f(x + h) − f(x)] / h', formulaTag: 'local slope · forward difference',
        formulaNote: 'On a computer h cannot be zero. Choose a small grid spacing and estimate the slope from nearby samples; the units are units of f divided by units of x.',
        symbols: [
          { token: 'df/dx', text: 'How quickly f changes as x changes; slope at one point.' },
          { token: 'h', text: 'A small step in x. Smaller is not always better on a computer: round-off matters.' },
          { token: 'Δf', text: 'The change in f over that step.' },
          { token: 'df/dt', text: 'A time rate, such as acceleration when f is velocity.' }
        ],
        workedHeading: 'Try a value by hand',
        worked: 'For f(x) = x² at x = 3, use h = 0.01. The forward difference is ((3.01)² − 3²)/0.01 = 6.01. The exact derivative is 2x = 6, so the estimate is already close.',
        workedMath: 'slope ≈ 6.01\nexact slope = 6',
        lab: 'derivative',
        paperBridge: 'Grid-based solvers replace derivatives with differences between neighbouring cells. The spacing Δx belongs in the denominator: leave it out and the value has the wrong units and changes when you resize the grid.',
        challenge: 'Drag the point on the graph. Where is the slope zero? What is different about the curve at those points?',
        challengeAnswer: 'For sin(x), the slope is cos(x), so it is zero at x = −π/2 and x = π/2. Those are the local low and high points: the curve is momentarily flat before it turns.',
        quiz: {
          question: 'If f is measured in metres and x in seconds, what are the units of df/dx?',
          options: ['metres per second', 'seconds per metre', 'metres × seconds'], correct: 0,
          explanation: 'A derivative divides change in the output by change in the input, so its units are metres/second.'
        }
      },
      {
        id: 'gradient', title: 'Partial derivatives & the gradient', duration: '11 min',
        deck: 'In a field, you can move in several directions. Partial derivatives ask about one direction at a time; the gradient gathers those answers into a vector.',
        aim: 'Find the direction a scalar field increases fastest, and connect that direction to pressure forces and surface normals.',
        intuitionTitle: 'Change one coordinate. Hold the others still.',
        intuition: 'The partial derivative ∂p/∂x measures how pressure changes as you move along x while holding y and z fixed. The gradient collects all three directional changes. It points toward the steepest increase; its length is the steepness.',
        analogy: 'Imagine standing on a hillside. The gradient points straight uphill. To roll downhill, move in the opposite direction: −∇p.',
        formula: '∇p = (∂p/∂x, ∂p/∂y, ∂p/∂z)', formulaTag: 'gradient of a scalar field',
        formulaNote: 'The symbol ∇ (del or nabla) is a compact package of spatial derivatives. Applied to a scalar it produces a vector.',
        symbols: [
          { token: '∇p', text: 'Pressure gradient: direction and rate of greatest pressure increase.' },
          { token: '∂/∂x', text: 'Change along x only; freeze the other coordinates.' },
          { token: '−∇p/ρ', text: 'Pressure acceleration in a constant-density fluid, toward lower pressure.' },
          { token: '∇φ/|∇φ|', text: 'A unit surface normal when φ is a smooth signed-distance field.' }
        ],
        workedHeading: 'A small pressure field',
        worked: 'Let p(x,y) = x² + 2y. Its gradient is (2x, 2). At (1,0) that is (2,2): pressure rises diagonally up-right. A fluid pressure force points the other way, proportional to (−2,−2)/ρ.',
        workedMath: 'p(x,y) = x² + 2y\n∇p(1,0) = (2, 2)',
        paperBridge: 'In fluid papers, ∇p is a force direction. In rendering, ∇ of a signed-distance or density field can provide a surface normal. Same operator; the field you feed it changes the meaning.',
        challenge: 'If a pressure field is uniform everywhere, what is its gradient and what pressure acceleration does it create?',
        challengeAnswer: 'Its gradient is zero, so a uniform pressure creates no local pressure acceleration. Only pressure differences create a pressure-gradient force.',
        quiz: {
          question: 'For p(x,y) = x² + 2y, what is ∇p at (1,0)?',
          options: ['(2, 2)', '(1, 0)', '(2, 0)'], correct: 0,
          explanation: '∂p/∂x = 2x and ∂p/∂y = 2. At (1,0), the gradient is (2,2).'
        }
      },
      {
        id: 'integral', title: 'Integrals: add up tiny pieces', duration: '12 min',
        deck: 'An integral accumulates contributions across space or time. On a computer, it becomes a weighted sum of samples.',
        aim: 'Read an integral as a sum, track the units, and see why ray transmittance is an exponential of an integral.',
        intuitionTitle: 'Count the little contributions.',
        intuition: 'Cut an interval into small pieces. On each piece, multiply the local value by its width, then add them. As the pieces get thinner, the sum approaches the integral. The area under a curve is one example; total mass, energy, and light attenuation are others.',
        analogy: 'A Riemann sum is a tray of tiny tiles. The integral is the total amount of material when the tiles become arbitrarily fine.',
        formula: '∫ₐᵇ f(x) dx  ≈  Σᵢ f(xᵢ) Δx', formulaTag: 'continuous accumulation → discrete sum',
        formulaNote: 'The differential dx is not decoration: it carries the width of each tiny piece. Units multiply too. (1/metre) × metre = dimensionless.',
        symbols: [
          { token: '∫', text: 'Accumulate all local contributions over the interval or region.' },
          { token: 'f(xᵢ)', text: 'The value sampled in cell i; midpoint samples are common.' },
          { token: 'Δx', text: 'Cell width. Each sample is weighted by the size of its piece.' },
          { token: 'Σ', text: 'The finite sum a program can actually evaluate.' }
        ],
        workedHeading: 'The rendering connection',
        worked: 'For a ray crossing a participating medium, σₜ(s) is extinction per metre. Its integral τ = ∫σₜ ds is optical depth (unitless), and T = exp(−τ) is the fraction of light transmitted. More density or a longer path means less light gets through.',
        workedMath: 'τ = ∫ σₜ ds\nT = e^(−τ)',
        lab: 'integral',
        paperBridge: 'When you see an integral in a rendering paper, ask: what is being accumulated, along which path or domain, and what are the units after multiplying by the measure (dx, dA, dω)?',
        challenge: 'If the same medium is twice as thick, but has constant extinction, what happens to optical depth τ?',
        challengeAnswer: 'It doubles: τ is the integral of a constant extinction over distance, so doubling the path length doubles τ. Transmittance then falls exponentially: T becomes e^(−2τ), not simply half.',
        quiz: {
          question: 'In a Riemann sum, what does f(xᵢ) Δx represent?',
          options: ['One small piece of the accumulated total.', 'The slope at xᵢ.', 'The total integral, independent of the other cells.'], correct: 0,
          explanation: 'The sample value times its cell width estimates the contribution from that small cell. The integral is the sum of all the pieces.'
        }
      }
    ]
  },
  {
    title: 'Read a field',
    shortTitle: 'Read a field',
    description: 'Use the vector-calculus operators that describe sources, spin, and flux.',
    lessons: [
      {
        id: 'divergence', title: 'Divergence: is stuff spreading out?', duration: '12 min',
        deck: 'Divergence measures net outflow from an infinitesimally small region. It is the key local test for whether a flow expands, compresses, or preserves volume.',
        aim: 'Interpret positive, negative, and zero divergence, and explain why incompressible flow satisfies ∇ · u = 0.',
        intuitionTitle: 'Put a tiny balloon in the flow.',
        intuition: 'Imagine a tiny balloon carried with the fluid. If more velocity carries fluid out of the balloon than into it, the balloon locally expands: divergence is positive. More coming in than going out means negative divergence. Equal in and out means zero.',
        analogy: 'Divergence is not the speed of the arrows. A fast, uniform current can have zero divergence. It asks whether the arrows spread apart or converge nearby.',
        formula: '∇ · u = ∂uₓ/∂x + ∂uᵧ/∂y + ∂u_z/∂z', formulaTag: 'divergence of a velocity field',
        formulaNote: 'Each component is differentiated along its own axis, then the results are added. In 2D, drop the z term.',
        symbols: [
          { token: 'u', text: 'Velocity vector field (uₓ, uᵧ, u_z).' },
          { token: '∇ · u', text: 'A scalar: local net outflow per unit volume.' },
          { token: '> 0', text: 'Local expansion or source; fluid leaves a tiny region faster than it enters.' },
          { token: '= 0', text: 'No local volume expansion. Incompressible flow may still move and swirl.' }
        ],
        workedHeading: 'A field you can calculate',
        worked: 'For u(x,y,z) = (x,y,z), each component grows at rate 1 along its matching axis. So ∇ · u = 1 + 1 + 1 = 3: a little volume expands in all three directions. The source field in the lab is the 2D version, so its divergence is 2A.',
        workedMath: 'u = (x, y, z)\n∇ · u = 1 + 1 + 1 = 3',
        lab: 'field', fieldMode: 'source',
        paperBridge: 'Smoke and water solvers often enforce ∇ · u = 0 at each grid cell. This is a local volume-preservation condition, not “no motion.” Use the Source button in the field lab to see what a positive value looks like.',
        challenge: 'The source field in the lab is u = A(x,y). What is its divergence in 2D? What happens when A doubles?',
        challengeAnswer: '∇ · u = ∂(Ax)/∂x + ∂(Ay)/∂y = A + A = 2A. Doubling the field strength doubles the divergence; the shape stays the same.',
        quiz: {
          question: 'An incompressible velocity field has…',
          options: ['zero divergence, but it may still move and rotate.', 'zero velocity everywhere.', 'zero curl everywhere.'], correct: 0,
          explanation: 'Incompressibility means local volume is preserved, so ∇ · u = 0. It says nothing by itself about speed or curl.'
        }
      },
      {
        id: 'curl', title: 'Curl: how much is the field spinning?', duration: '12 min',
        deck: 'Curl measures the local tendency of a vector field to rotate. In a 2D fluid, its out-of-plane component is the vorticity you often see plotted.',
        aim: 'Read the direction and magnitude of curl, compute 2D vorticity, and distinguish spin from mere curved motion.',
        intuitionTitle: 'Imagine a microscopic paddle wheel.',
        intuition: 'Place a tiny paddle wheel at a point. If nearby flow makes it spin, the field has curl there. The curl vector points along the spin axis; its magnitude measures local circulation per unit area. In 2D, the spin axis points along z, out of the screen.',
        analogy: 'A whole field can have curved streamlines without spinning a tiny paddle wheel at every point. Curl is local: shrink the paddle wheel toward a point before deciding.',
        formula: '∇ × u = (∂u_z/∂y − ∂uᵧ/∂z,\n           ∂uₓ/∂z − ∂u_z/∂x,\n           ∂uᵧ/∂x − ∂uₓ/∂y)', formulaTag: 'curl in 3D · z component in 2D',
        formulaNote: 'For a 2D velocity u = (uₓ,uᵧ), the vorticity is ω_z = ∂uᵧ/∂x − ∂uₓ/∂y. Keep the order: y-component differentiated in x, minus x-component differentiated in y.',
        symbols: [
          { token: '∇ × u', text: 'A vector that describes local rotation of a vector field.' },
          { token: 'ω_z', text: 'The 2D vorticity, pointing out of or into the screen.' },
          { token: 'u = (−Ωy, Ωx)', text: 'Rigid rotation; its curl is 2Ω, twice the angular velocity.' },
          { token: 'ω = 0', text: 'Locally irrotational flow; this does not require u itself to be zero.' }
        ],
        workedHeading: 'Rigid rotation, without guessing',
        worked: 'For u = (−Ωy, Ωx), ∂uᵧ/∂x = Ω and ∂uₓ/∂y = −Ω. Therefore ω_z = Ω − (−Ω) = 2Ω. A tiny paddle wheel turns at angular speed Ω; curl is twice that rate.',
        workedMath: 'ω_z = ∂uᵧ/∂x − ∂uₓ/∂y\n     = Ω − (−Ω) = 2Ω',
        lab: 'field', fieldMode: 'swirl',
        paperBridge: 'Fluid solvers use vorticity to describe visible swirls and sometimes add vorticity confinement to counter numerical damping. In the lab, switch from Source to Swirl: divergence becomes zero while curl becomes nonzero.',
        challenge: 'The swirl field in the lab is u = (−Ay, Ax). What are divergence and z-curl?',
        challengeAnswer: 'Divergence is ∂(−Ay)/∂x + ∂(Ax)/∂y = 0 + 0 = 0. Curl is ∂(Ax)/∂x − ∂(−Ay)/∂y = A − (−A) = 2A.',
        quiz: {
          question: 'For rigid rotation u = (−Ωy, Ωx), the 2D curl is…',
          options: ['2Ω, pointing along the rotation axis.', '0, because the arrows are tangent to circles.', 'Ω², because rotation is quadratic.'], correct: 0,
          explanation: 'The derivatives are ∂uᵧ/∂x = Ω and ∂uₓ/∂y = −Ω, so ω_z = Ω − (−Ω) = 2Ω.'
        }
      },
      {
        id: 'theorems', title: 'Gauss & Stokes: local rules, global totals', duration: '10 min',
        deck: 'Two famous theorems turn local derivatives into boundary measurements. They are the bridge between differential and integral equations.',
        aim: 'Explain divergence as boundary flux and curl as circulation density, and recognize why the same laws have local and integral forms.',
        intuitionTitle: 'Measure what crosses the boundary.',
        intuition: 'Gauss says the total divergence inside a volume equals the net flux through its closed surface. Stokes says the curl passing through a surface equals circulation around its edge. The interior bookkeeping and the boundary measurement agree.',
        analogy: 'A sealed box cannot hide net creation: total sources inside must show up as net outward flow at the walls. Around a rim, all the tiny local spins add up to circulation around the loop.',
        formula: '∫ᵥ (∇ · u) dV = ∮∂ᵥ u · n dA\n∫ₛ (∇ × u) · n dA = ∮∂ₛ u · dl', formulaTag: 'divergence theorem · Stokes theorem',
        formulaNote: 'The first relates a volume integral to outward flux through its closed boundary. The second relates surface-integrated curl to circulation around the boundary curve, with compatible right-hand-rule orientation.',
        symbols: [
          { token: 'dV', text: 'A tiny volume element inside V.' },
          { token: 'n dA', text: 'An outward-facing area element on the boundary.' },
          { token: 'u · n', text: 'The component of velocity crossing the surface; tangential flow contributes no flux.' },
          { token: 'u · dl', text: 'The component along the boundary curve; its integral is circulation.' }
        ],
        workedHeading: 'Why papers switch forms',
        worked: 'A local solver may enforce ∇ · u = 0 in each cell. Gauss tells you the same statement means zero net flux through every closed region. Maxwell laws are often written both ways: local field rules and whole-surface or loop balances.',
        workedMath: 'local change inside\n= net crossing the boundary',
        lab: 'field', fieldMode: 'source',
        paperBridge: 'When a derivation changes a volume integral to a surface integral (or curl to a loop integral), look for Gauss or Stokes. Boundary conditions matter: the theorem does not make the boundary disappear; it makes its role explicit.',
        challenge: 'If ∇ · u = 0 everywhere in a region, what is the net velocity flux through any closed surface inside it?',
        challengeAnswer: 'Zero. By the divergence theorem, the flux is the volume integral of zero divergence, which is zero. Individual parts of the surface can still have inward and outward flow.',
        quiz: {
          question: 'The divergence theorem turns volume-integrated divergence into…',
          options: ['net outward flux through the closed boundary.', 'circulation around one open curve.', 'the largest velocity in the volume.'], correct: 0,
          explanation: 'Gauss’s divergence theorem equates ∫V ∇ · u dV with the outward flux ∮∂V u · n dA.'
        }
      }
    ]
  },
  {
    title: 'Make a fluid',
    shortTitle: 'Make a fluid',
    description: 'Read the transport, force balance, and numerical steps in a fluid solver.',
    lessons: [
      {
        id: 'advection', title: 'Advection: move a quantity with flow', duration: '11 min',
        deck: 'Advection is transport by motion. It explains how smoke, dye, temperature, or velocity gets carried from one place to another.',
        aim: 'Read the material derivative and understand the backtrace used by a semi-Lagrangian advection step.',
        intuitionTitle: 'Follow the moving parcel, not just the fixed point.',
        intuition: 'At a fixed location, q can change because time passes there, ∂q/∂t. It can also change because moving fluid carries a different value into that location, u · ∇q. The chain rule makes this precise: along a parcel path xₚ(t), dq(xₚ(t),t)/dt = ∂q/∂t + (dxₚ/dt) · ∇q. Since the parcel velocity is u, these pieces form the material derivative: the change felt while riding with the fluid.',
        analogy: 'A leaf can pass a stationary observer even if its colour never changes. The observer sees a changing value because the leaf moves through space: that is advection.',
        formula: 'Dq/Dt = ∂q/∂t + u · ∇q = 0\nqⁿ⁺¹(x) ≈ qⁿ(x − u Δt)', formulaTag: 'transport · semi-Lagrangian backtrace',
        formulaNote: 'For pure advection, the value is constant along a moving parcel. A semi-Lagrangian update traces backward from the destination to find where the parcel came from, then samples the old field there.',
        symbols: [
          { token: 'Dq/Dt', text: 'Rate of change following the moving fluid.' },
          { token: 'u · ∇q', text: 'Transport rate: velocity dotted with the spatial gradient.' },
          { token: 'x − uΔt', text: 'Backtrace from the arrival point to an approximate departure point.' },
          { token: 'qⁿ⁺¹', text: 'The advected quantity after one time step.' }
        ],
        workedHeading: 'Read the minus sign',
        worked: 'If fluid moves right at speed u > 0, a sample arriving at x came from slightly to the left, x − uΔt. Sample there, usually with interpolation. Tracing backward is why the formula has a minus sign.',
        workedMath: 'velocity → right\ntrace sample ← left',
        lab: 'advection',
        paperBridge: 'Look for “semi-Lagrangian,” “characteristic,” or “backtrace” in a solver paper. Those words describe following the flow backward to sample a transported field. Interpolation is part of the method, not an implementation footnote.',
        challenge: 'In the advection lab, make velocity positive. Which way does the dye blob move? Where does the solver look up its old value?',
        challengeAnswer: 'The blob moves right. For a destination point x, the backtrace looks left to x − uΔt to find the old value that arrived there.',
        quiz: {
          question: 'For a constant positive velocity to the right, semi-Lagrangian advection samples the old field…',
          options: ['upstream, to the left of the destination point.', 'downstream, to the right of the destination point.', 'at the destination only, with no backtrace.'], correct: 0,
          explanation: 'The departure point is x − uΔt. If u is positive, that point lies to the left of the arrival point.'
        }
      },
      {
        id: 'navier-stokes', title: 'Navier–Stokes: the fluid’s momentum ledger', duration: '14 min',
        deck: 'The Navier–Stokes equation is a balance sheet: fluid acceleration on one side, pressure, viscosity, and forces on the other.',
        aim: 'Name every term in the incompressible momentum equation and connect each one to a physical effect.',
        intuitionTitle: 'Acceleration comes from causes.',
        intuition: 'For a constant-density Newtonian fluid, velocity changes because pressure pushes, viscosity smooths, and body forces act. The left side includes both change at a fixed point and change from moving through a nonuniform velocity field.',
        analogy: 'Think of a parcel of fluid as a tiny object with an ever-changing velocity. Pressure and gravity are the pushes; viscosity shares momentum with neighbouring parcels.',
        formula: '∂u/∂t + (u · ∇)u = −∇p/ρ + ν∇²u + f\n∇ · u = 0', formulaTag: 'incompressible · constant density · Newtonian fluid',
        formulaNote: 'Click a term to unpack it. This is a model with assumptions, not a universal equation for every material or flow.',
        symbols: [
          { token: 'u, p', text: 'Velocity field and pressure field.' },
          { token: 'ρ', text: 'Mass density; pressure gradient divided by density is acceleration.' },
          { token: 'ν', text: 'Kinematic viscosity; it controls momentum diffusion.' },
          { token: 'f', text: 'Body force per unit mass, such as gravity or an applied force.' }
        ],
        terms: [
          { label: '∂u/∂t', detail: '<strong>Local acceleration.</strong> Velocity changing at a fixed location. Units: m/s².' },
          { label: '(u · ∇)u', detail: '<strong>Convective acceleration.</strong> A parcel moves into a region with a different velocity. This is why steady flow can still accelerate.' },
          { label: '−∇p/ρ', detail: '<strong>Pressure acceleration.</strong> Pushes fluid from high toward low pressure. The minus sign gives the downhill direction.' },
          { label: 'ν∇²u', detail: '<strong>Viscous diffusion.</strong> Neighbouring velocities smooth one another. The Laplacian is a spatial measure of how a value differs from its neighbourhood.' },
          { label: 'f', detail: '<strong>Body force.</strong> Gravity is a common example. Here f is acceleration per unit mass, so its units are m/s².' }
        ], termsIntro: 'Select a piece of the balance:',
        workedHeading: 'A units check',
        worked: 'Every term has acceleration units. ∂u/∂t is (m/s)/s. For pressure, (∇p)/ρ is (Pa/m)/(kg/m³) = m/s². Matching units are a quick way to catch a missing density or length scale.',
        workedMath: 'left: m/s²\nright: m/s²',
        lab: 'field', fieldMode: 'source',
        paperBridge: 'Many graphics papers use a discretized, dimensionless, or modified form. Before comparing formulas, identify what was nondimensionalized, which terms were dropped, and how pressure is scaled.',
        challenge: 'Which term can create acceleration even when the velocity field is steady in time?',
        challengeAnswer: 'The convective term (u · ∇)u. “Steady” means ∂u/∂t = 0 at a fixed point; a parcel can still move into regions with different velocity.',
        quiz: {
          question: 'A steady flow has ∂u/∂t = 0. Which acceleration can still remain?',
          options: ['Convective acceleration (u · ∇)u.', 'No acceleration of any kind.', 'The pressure term must also be zero.'], correct: 0,
          explanation: 'A moving parcel can experience changing velocity as it travels through a spatially varying field, even when the field is steady at fixed locations.'
        }
      },
      {
        id: 'projection', title: 'Pressure projection: remove compression', duration: '12 min',
        deck: 'A common incompressible solver first moves velocity forward, then corrects it so no fluid is created or destroyed inside a cell.',
        aim: 'Explain the pressure solve as a projection onto divergence-free velocity fields.',
        intuitionTitle: 'Pressure is the correction that restores volume.',
        intuition: 'After advection and forces, a tentative velocity u* may have nonzero divergence. Subtract a pressure gradient to cancel that divergence. Taking divergence of the corrected velocity gives a Poisson equation for pressure.',
        analogy: 'Imagine several neighbours pushing fluid into one grid cell. Pressure rises there and pushes back out. The pressure field is chosen globally so all local volume errors cancel.',
        formula: 'uⁿ⁺¹ = u* − (Δt/ρ) ∇p\n∇²p = (ρ/Δt) ∇ · u*', formulaTag: 'velocity correction · pressure Poisson equation',
        formulaNote: 'The second line follows by taking divergence of the first and requiring ∇ · uⁿ⁺¹ = 0. Boundary conditions and the discrete operator must be consistent with the grid.',
        symbols: [
          { token: 'u*', text: 'Tentative velocity after advection and forces, before projection.' },
          { token: 'p', text: 'Pressure chosen to remove the velocity’s divergence.' },
          { token: '∇²', text: 'Laplacian: divergence of the gradient, a sum of second spatial derivatives.' },
          { token: 'uⁿ⁺¹', text: 'Corrected velocity for the next simulation step.' }
        ],
        workedHeading: 'Follow the derivation',
        worked: 'Take divergence of uⁿ⁺¹ = u* − (Δt/ρ)∇p. Set the result to zero. Then ∇ · u* − (Δt/ρ)∇²p = 0. Rearranging produces the pressure Poisson equation shown above.',
        workedMath: 'div(corrected velocity) = 0\nsolve for p, then correct u*',
        lab: 'field', fieldMode: 'source',
        paperBridge: 'A pressure “solve” usually means solving a sparse Poisson system on a grid, often iteratively. If the method seems mysterious, trace the two steps: make tentative u*, solve for p, subtract ∇p.',
        challenge: 'If the tentative velocity has zero divergence already, what pressure correction is needed in the idealized interior?',
        challengeAnswer: 'No pressure gradient is needed to fix divergence in that idealized case; the right-hand side of the Poisson equation is zero. Boundaries or pressure gauges may still matter in a full solver.',
        quiz: {
          question: 'Why solve a Poisson equation for pressure in an incompressible projection?',
          options: ['So subtracting its gradient makes the corrected velocity divergence-free.', 'To make the velocity zero at every grid cell.', 'To advect density without interpolation.'], correct: 0,
          explanation: 'Pressure is chosen so the divergence of u* − (Δt/ρ)∇p vanishes. Taking divergence gives the pressure Poisson equation.'
        }
      },
      {
        id: 'discretize', title: 'Grids, differences & the CFL condition', duration: '13 min',
        deck: 'A computer replaces continuous fields with cell values and derivatives with stencils. The grid spacing and time step become part of the mathematics.',
        aim: 'Read common finite-difference stencils, explain a CFL restriction, and distinguish stability from accuracy.',
        intuitionTitle: 'The grid is a measuring instrument.',
        intuition: 'A grid samples the field at points or cell centres. A centred difference compares neighbours on either side. A Laplacian compares a value to its neighbourhood. Refining the grid changes the spacing in every formula.',
        analogy: 'If fluid can cross ten cells in one update, the simulation has skipped over detail its grid was meant to resolve. CFL restrictions limit how far information travels per step.',
        formula: '∂f/∂x|ᵢ ≈ (fᵢ₊₁ − fᵢ₋₁)/(2Δx)\n∇²fᵢ ≈ (fᵢ₊₁ − 2fᵢ + fᵢ₋₁)/Δx²\nΔt ≲ C Δx / max|u|', formulaTag: 'centred differences · 1D Laplacian · CFL scale',
        formulaNote: 'The CFL number C depends on the scheme and dimensions; for simple explicit advection it is often at most about 1. This is a guideline for a stated method, not a universal constant.',
        symbols: [
          { token: 'Δx', text: 'Distance between samples or grid cells.' },
          { token: 'fᵢ₊₁, fᵢ₋₁', text: 'Neighbouring samples on either side of cell i.' },
          { token: 'Δt', text: 'Time step; smaller steps usually cost more but reduce temporal error.' },
          { token: 'C', text: 'Allowed Courant number for the chosen numerical scheme.' }
        ],
        workedHeading: 'A quick CFL estimate',
        worked: 'If the fastest flow is 2 m/s and cells are 0.1 m wide, one cell-crossing time is Δx/|u| = 0.05 s. An explicit scheme with C = 0.5 would use Δt ≤ 0.025 s as a stability-oriented limit.',
        workedMath: 'Δx = 0.1 m, |u| = 2 m/s\nΔt ≤ 0.5 × 0.1/2 = 0.025 s',
        paperBridge: 'When a paper says “stable,” ask: stable for which discretization, boundary conditions, and time integrator? Stability prevents blow-up; it does not guarantee the result is accurate or well-resolved.',
        challenge: 'If you halve Δx but keep the same maximum speed and CFL number, what happens to the allowed Δt for explicit advection?',
        challengeAnswer: 'It also halves: Δt ≲ CΔx/max|u|. A finer grid needs a proportionally smaller step for the same CFL number, which is why resolution can get expensive.',
        quiz: {
          question: 'For fixed speed and CFL number, halving the grid spacing generally means…',
          options: ['halving the explicit-advection time step.', 'doubling the time step.', 'the time step no longer matters.'], correct: 0,
          explanation: 'The CFL scale is proportional to Δx/max|u|, so halving Δx halves the allowed Δt for fixed speed and C.'
        }
      }
    ]
  },
  {
    title: 'Render light',
    shortTitle: 'Render light',
    description: 'Meet Maxwell’s field laws, then follow their path into practical rendering.',
    lessons: [
      {
        id: 'maxwell', title: 'Maxwell’s equations: four field laws', duration: '15 min',
        deck: 'The same divergence and curl you use in fluids describe how electric and magnetic fields are sourced, coupled, and changed in time.',
        aim: 'Translate all four Maxwell equations in vacuum SI form and identify what each one says physically.',
        intuitionTitle: 'Fields have sources, loops, and time links.',
        intuition: 'Electric charge sources electric field. Magnetic field has no observed monopole source in classical electromagnetism. Changing magnetic fields create circulating electric fields; current and changing electric fields create circulating magnetic fields.',
        analogy: 'Two equations are divergence laws (sources and no magnetic monopoles). Two are curl laws (circulation linked to changing fields). Maxwell’s displacement-current term is what lets electromagnetic waves propagate in vacuum.',
        formula: '∇ · E = ρₑ/ε₀        ∇ · B = 0\n∇ × E = −∂B/∂t\n∇ × B = μ₀J + μ₀ε₀ ∂E/∂t', formulaTag: 'vacuum SI form · microscopic fields',
        formulaNote: 'These are the vacuum SI equations with charge density ρₑ and current density J. Material-medium formulations use D and H and have different constitutive details.',
        symbols: [
          { token: 'E, B', text: 'Electric field and magnetic flux density.' },
          { token: 'ρₑ, J', text: 'Electric charge density and current density.' },
          { token: 'ε₀, μ₀', text: 'Vacuum permittivity and permeability.' },
          { token: '∇· / ∇×', text: 'Divergence asks about sources; curl asks about local circulation.' }
        ],
        terms: [
          { label: '∇ · E = ρₑ/ε₀', detail: '<strong>Gauss’s electric law.</strong> Charge density is the source of electric-field divergence.' },
          { label: '∇ · B = 0', detail: '<strong>Gauss’s magnetic law.</strong> Magnetic field has no net source or sink in this classical model; magnetic field lines close.' },
          { label: '∇ × E = −∂B/∂t', detail: '<strong>Faraday’s law.</strong> A changing magnetic field produces a circulating electric field. The minus sign encodes Lenz’s law.' },
          { label: '∇ × B = μ₀J + μ₀ε₀∂E/∂t', detail: '<strong>Ampère–Maxwell law.</strong> Current and a changing electric field produce magnetic circulation. The displacement-current term is essential for waves.' }
        ], termsIntro: 'Tap each law to translate it:',
        workedHeading: 'Recognize the two families',
        worked: 'The first pair has divergence on the left: they describe field sources. The second pair has curl on the left: they describe circulation and changing fields. Maxwell connects the two operators from the vector-calculus unit.',
        workedMath: 'divergence → source balance\ncurl → circulation / induction',
        lab: 'field', fieldMode: 'swirl',
        paperBridge: 'In rendering, most real-time scenes are not solved by numerically integrating Maxwell’s equations. They are usually handled with geometric optics and material models. Maxwell explains what light is; the renderer uses a scale-appropriate approximation.',
        challenge: 'In a charge-free region, what does ∇ · E become? Does that force E itself to be zero?',
        challengeAnswer: '∇ · E = 0 where ρₑ = 0, but E need not be zero. A uniform nonzero electric field has zero divergence, for example; the equation rules out local charge sources there.',
        quiz: {
          question: 'The vacuum equation ∇ · B = 0 means…',
          options: ['there are no magnetic monopole sources in this classical field model.', 'the magnetic field B must be zero.', 'magnetic fields never change with time.'], correct: 0,
          explanation: 'Zero divergence rules out local magnetic sources or sinks, but nonzero magnetic fields can still exist and change in time.'
        }
      },
      {
        id: 'waves', title: 'From Maxwell to waves (and why we ray trace)', duration: '11 min',
        deck: 'Coupled electric and magnetic fields can sustain waves through empty space. Rendering usually models those waves with rays because scenes are enormous compared with a wavelength.',
        aim: 'Recognize the electromagnetic wave equation and explain why practical rendering often uses geometric optics instead.',
        intuitionTitle: 'A changing field makes the other field change.',
        intuition: 'In empty space, a changing magnetic field curls the electric field, and a changing electric field curls the magnetic field. Combine those two curl laws and each field obeys a wave equation travelling at speed c.',
        analogy: 'Visible-light wavelengths are hundreds of nanometres; a room is billions of times larger. Tracking every oscillation is unnecessary for ordinary images, so path tracing follows energy along rays and uses reflection/refraction models at surfaces.',
        formula: '∇²E − (1/c²) ∂²E/∂t² = 0\nc = 1/√(μ₀ε₀)', formulaTag: 'electromagnetic wave equation in vacuum',
        formulaNote: 'This vacuum result assumes no free charge or current in the region. The vector Laplacian acts component-wise in Cartesian coordinates.',
        symbols: [
          { token: '∇²E', text: 'Spatial curvature of the electric field.' },
          { token: '∂²E/∂t²', text: 'Second change in time; wave acceleration.' },
          { token: 'c', text: 'Wave speed in vacuum, about 3 × 10⁸ m/s.' },
          { token: 'μ₀ε₀', text: 'Vacuum constants that set the speed of electromagnetic propagation.' }
        ],
        workedHeading: 'The rendering bridge',
        worked: 'Maxwell’s equations underpin light and the boundary behaviour of materials. Most graphics renderers replace microscopic oscillating fields with radiance traveling along rays, plus Fresnel reflection, refraction, and absorption models. This is a powerful approximation, not a denial of electromagnetism.',
        workedMath: 'Maxwell fields → optical rays\nwhen wavelength ≪ scene scale',
        paperBridge: 'If a paper covers diffraction, polarization, metasurfaces, or sub-wavelength structure, geometric optics may fail and field-based methods can matter. For ordinary scenes, ray/energy transport is usually the right model.',
        challenge: 'Why is it usually wasteful to solve every optical oscillation in a metre-scale scene?',
        challengeAnswer: 'Visible wavelengths are roughly 10⁻⁷ metres, far smaller than the scene. Resolving every oscillation would require an enormous number of samples, while geometric optics captures the image-forming behaviour at the larger scale.',
        quiz: {
          question: 'The wave speed in vacuum is set by…',
          options: ['1/√(μ₀ε₀).', 'μ₀ + ε₀.', 'the local curl of the electric field alone.'], correct: 0,
          explanation: 'Combining the vacuum Maxwell equations gives c = 1/√(μ₀ε₀), approximately 3 × 10⁸ m/s.'
        }
      },
      {
        id: 'rendering-equation', title: 'The rendering equation: light paths as an integral', duration: '13 min',
        deck: 'At a surface point, outgoing light is emitted light plus reflected incoming light accumulated over all directions in the hemisphere.',
        aim: 'Identify radiance, the BRDF, cosine weighting, and the hemisphere integral that path tracing estimates.',
        intuitionTitle: 'Every incoming direction can contribute.',
        intuition: 'A surface receives light from many directions. The material decides how much arrives from each direction and leaves toward the camera. Add those contributions over the hemisphere, weighting by the surface angle.',
        analogy: 'The integral is a sum over an uncountably large collection of possible light directions. A path tracer samples a few directions and averages them instead of evaluating every one.',
        formula: 'Lₒ(x,ωₒ) = Lₑ(x,ωₒ) +\n∫Ω fᵣ(x,ωᵢ,ωₒ) Lᵢ(x,ωᵢ) max(0,n·ωᵢ) dωᵢ', formulaTag: 'surface rendering equation · outgoing radiance',
        formulaNote: 'This common form assumes a surface with a BRDF. The integral is over the incoming hemisphere Ω; exact conventions for directions and measures can vary between texts.',
        symbols: [
          { token: 'Lₒ, Lᵢ', text: 'Outgoing and incoming radiance: light traveling in a direction.' },
          { token: 'Lₑ', text: 'Radiance emitted by the surface itself.' },
          { token: 'fᵣ', text: 'BRDF: how a material scatters incoming light into outgoing directions.' },
          { token: 'n · ωᵢ', text: 'Cosine factor: a tilted patch receives less light per unit area.' },
          { token: 'dωᵢ', text: 'A tiny solid angle; the integral sums over incoming directions.' }
        ],
        terms: [
          { label: 'Lₑ', detail: '<strong>Emission.</strong> Light the surface adds on its own, such as a glowing panel.' },
          { label: 'fᵣ', detail: '<strong>Material response.</strong> The BRDF describes how much incoming light from ωᵢ is reflected toward ωₒ.' },
          { label: 'Lᵢ', detail: '<strong>Incoming radiance.</strong> Light arriving from a sampled direction, often found by tracing a ray into the scene.' },
          { label: 'max(0,n·ωᵢ)', detail: '<strong>Projected area.</strong> The cosine reduces contribution for grazing directions and clips directions below the surface.' },
          { label: '∫Ω … dωᵢ', detail: '<strong>Accumulate directions.</strong> Monte Carlo path tracing estimates this integral with random samples and averages.' }
        ], termsIntro: 'Read the integral from left to right:',
        workedHeading: 'Why path tracing converges',
        worked: 'If incoming directions are sampled from a probability density, each sample is weighted to account for how likely it was. Averaging many properly weighted samples estimates the hemisphere integral. More samples reduce noise; they do not change the lighting equation.',
        workedMath: 'integral over directions\n≈ weighted sample average',
        paperBridge: 'When comparing rendering equations, check the direction convention, whether f includes a cosine, and the probability density used for sampling. Different-looking formulas can describe the same transport with different conventions.',
        challenge: 'A direction lies below the surface, so n · ωᵢ is negative. What does max(0,n · ωᵢ) contribute?',
        challengeAnswer: 'Zero. Incoming directions below the surface hemisphere do not contribute to this surface reflection integral.',
        quiz: {
          question: 'The integral in the surface rendering equation accumulates light over…',
          options: ['incoming directions in the hemisphere above the surface.', 'all points in the entire universe with equal weight.', 'time only, with no directional information.'], correct: 0,
          explanation: 'The solid-angle measure dωᵢ integrates over incoming directions in the hemisphere Ω.'
        }
      },
      {
        id: 'volume-rendering', title: 'Volume rendering: march a ray through a medium', duration: '14 min',
        deck: 'Smoke, clouds, fog, and medical scans are not surfaces. A ray gathers light continuously while the medium both scatters and absorbs it.',
        aim: 'Connect extinction to transmittance and opacity, then read a front-to-back ray-marching update.',
        intuitionTitle: 'Light fades a little at every step.',
        intuition: 'Extinction σₜ says how strongly a medium removes light per unit distance. Along a path, tiny losses compound. The transmitted fraction is an exponential of the accumulated extinction; a renderer approximates that accumulation with samples.',
        analogy: 'A clear room barely dims a flashlight. A dense cloud dims it quickly. The cloud does not need a hard surface—the loss builds gradually along the ray.',
        formula: 'T(s) = exp(−∫₀ˢ σₜ(r) dr)\nαᵢ = 1 − exp(−σₜ,ᵢ Δs)\nL ← L + Tᵢ αᵢ cᵢ ;   Tᵢ₊₁ = Tᵢ(1 − αᵢ)', formulaTag: 'Beer–Lambert · discrete front-to-back march',
        formulaNote: 'In the discrete compositing form, cᵢ is the segment’s representative source colour under the chosen approximation. Scattering and emission models determine that colour; extinction determines how much of the segment contributes.',
        symbols: [
          { token: 'σₜ', text: 'Extinction coefficient, usually inverse metres; absorption plus out-scattering.' },
          { token: 'T(s)', text: 'Fraction of light that survives from the ray start to distance s.' },
          { token: 'αᵢ', text: 'Opacity over one step. Smaller Δs means smaller per-step opacity.' },
          { token: 'L, Tᵢ', text: 'Accumulated radiance and remaining transmittance before sample i.' }
        ],
        workedHeading: 'One stable step',
        worked: 'For constant σₜ across a segment, α = 1 − e^(−σₜΔs). Add the segment colour weighted by the light that reached it, Tαc. Then multiply the remaining transmittance by 1−α. Front-to-back compositing stops early when T is nearly zero.',
        workedMath: 'new light = T × α × c\nremaining light = T × (1 − α)',
        lab: 'volume',
        paperBridge: 'If a volume-rendering paper changes its step size, compare σₜΔs—not σₜ alone. Optical thickness is what controls per-step opacity. Correct step-size handling keeps the result from changing just because you march with more samples.',
        challenge: 'Double the number of ray-march steps across the same distance. What should happen to each step’s opacity, approximately?',
        challengeAnswer: 'Each Δs is about half as large, so αᵢ = 1−exp(−σₜΔs) gets smaller. Across the whole distance, the accumulated transmittance should stay approximately the same if the integration is accurate.',
        quiz: {
          question: 'If extinction σₜ and path length both increase, transmittance T…',
          options: ['decreases, because optical depth increases.', 'increases linearly.', 'must remain exactly one.'], correct: 0,
          explanation: 'T = exp(−∫σₜ ds). Greater extinction or a longer path increases the integral and reduces the transmitted fraction.'
        }
      }
    ]
  }
];

let lessonNumber = 0;
const allLessons = units.flatMap((unit, unitIndex) => unit.lessons.map((lesson) => ({
  ...lesson,
  unitIndex,
  index: lessonNumber++,
  globalNumber: lessonNumber
})));
const lessonById = new Map(allLessons.map((lesson) => [lesson.id, lesson]));
const TOTAL = allLessons.length;
const STORAGE_KEY = 'fieldwork-applied-math-v1';

function loadSavedState() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    const valid = new Set(allLessons.map((lesson) => lesson.id));
    return {
      completed: new Set(Array.isArray(raw.completed) ? raw.completed.filter((id) => valid.has(id)) : []),
      lastLesson: valid.has(raw.lastLesson) ? raw.lastLesson : null
    };
  } catch (_) {
    return { completed: new Set(), lastLesson: null };
  }
}

const savedState = loadSavedState();
const completedLessons = savedState.completed;
let currentLessonId = null;
let activeQuizAnswer = null;
let toastTimer = null;
let lastFocusedElement = null;
const collapsedUnits = new Set();
const fieldState = { mode: 'source', strength: 0.6 };
const courseContent = document.getElementById('course-content');
const courseNav = document.getElementById('courseNav');
const sidebar = document.getElementById('sidebar');
const sidebarBackdrop = document.getElementById('sidebarBackdrop');
const decoderDialog = document.getElementById('decoderDialog');

function escapeText(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function renderNavigation() {
  const html = units.map((unit, unitIndex) => {
    const unitLessons = allLessons.filter((lesson) => lesson.unitIndex === unitIndex);
    const finished = unitLessons.filter((lesson) => completedLessons.has(lesson.id)).length;
    const isCollapsed = collapsedUnits.has(unitIndex);
    return `<section class="nav-unit">
      <button class="nav-unit-heading" type="button" data-unit-toggle="${unitIndex}" aria-expanded="${!isCollapsed}">
        <span class="nav-unit-number">0${unitIndex + 1}</span>
        <span class="nav-unit-name">${escapeText(unit.shortTitle)}</span>
        <span class="nav-unit-count">${finished}/${unitLessons.length}</span>
        <span class="nav-chevron" aria-hidden="true">⌄</span>
      </button>
      <div class="nav-lessons" data-unit-lessons="${unitIndex}"${isCollapsed ? ' hidden' : ''}>
        ${unitLessons.map((lesson) => {
          const isComplete = completedLessons.has(lesson.id);
          const isCurrent = currentLessonId === lesson.id;
          return `<button class="nav-lesson${isComplete ? ' is-complete' : ''}" type="button" data-lesson="${lesson.id}"${isCurrent ? ' aria-current="page"' : ''}>
            <span class="nav-lesson-status" aria-hidden="true">✓</span>
            <span class="nav-lesson-title">${escapeText(lesson.title)}</span>
            <span class="nav-lesson-time">${escapeText(lesson.duration.replace(' min', 'm'))}</span>
          </button>`;
        }).join('')}
      </div>
    </section>`;
  }).join('');
  courseNav.innerHTML = html;
}

function renderProgress() {
  const count = completedLessons.size;
  const percent = Math.round((count / TOTAL) * 100);
  document.getElementById('sidebarProgressText').textContent = `${count} of ${TOTAL} lessons complete`;
  document.getElementById('sidebarProgressPercent').textContent = `${percent}%`;
  document.getElementById('sidebarProgressBar').style.width = `${percent}%`;
  document.getElementById('headerProgressText').textContent = `${count} / ${TOTAL} lessons`;
  document.getElementById('headerProgressBar').style.width = `${percent}%`;
}

function persistState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      completed: [...completedLessons],
      lastLesson: currentLessonId || savedState.lastLesson
    }));
  } catch (_) { /* Private browsing or storage restrictions should not block the course. */ }
}

function homeMarkup() {
  const nextIncomplete = allLessons.find((lesson) => !completedLessons.has(lesson.id));
  const continueLesson = currentLessonId ? lessonById.get(currentLessonId) : null;
  const primaryLesson = completedLessons.size === TOTAL ? allLessons[0] : continueLesson || nextIncomplete || allLessons[0];
  const ctaText = completedLessons.size === TOTAL ? 'Review lesson 01' : continueLesson ? 'Continue learning' : 'Begin with lesson 01';
  return `<div class="home-page">
    <section class="home-hero" aria-labelledby="homeTitle">
      <div class="hero-copy">
        <div class="home-kicker"><span></span> A HANDS-ON MATHEMATICS REFRESHER</div>
        <h1 id="homeTitle">Make the math<br>feel <em>physical.</em></h1>
        <p class="home-hero-copy">Remember the ideas. Rebuild the maths with small experiments, then use it to understand fluid simulations and rendered light.</p>
        <div class="hero-actions">
          <button class="button button-primary" type="button" data-lesson="${primaryLesson.id}">${ctaText} <span aria-hidden="true">→</span></button>
          <button class="button button-quiet" type="button" data-lesson="divergence">Jump to divergence <span aria-hidden="true">↗</span></button>
        </div>
        <div class="hero-foot"><span>15 short lessons</span><span>4 practical chapters</span><span>Interactive field labs</span></div>
      </div>
      <div class="hero-aside" aria-hidden="true">
        <svg class="hero-art" viewBox="0 0 270 270" role="img">
          <circle class="orbit" cx="135" cy="135" r="102"/>
          <circle class="orbit dashed" cx="135" cy="135" r="77"/>
          <circle class="orbit" cx="135" cy="135" r="49"/>
          <path class="flow-path" d="M35 120 C62 88 81 94 99 119 S137 157 161 124 204 82 235 113"/>
          <path class="flow-path" d="M42 160 C72 126 90 131 108 155 S145 189 170 157 207 121 230 151"/>
          <path class="flow-path" d="M68 55 C83 80 97 95 116 107"/>
          <path class="flow-path" d="M207 213 C190 189 177 174 158 162"/>
          <path class="flow-arrow" d="M229 110 l-8 -2 5 7z"/>
          <path class="flow-arrow" d="M226 148 l-8 -1 5 7z"/>
          <path class="flow-arrow" d="M115 106 l-1 -8 7 5z"/>
          <path class="flow-arrow" d="M158 162 l1 8 -7 -5z"/>
          <circle class="flow-node" cx="103" cy="120" r="5"/>
          <circle class="flow-node" cx="168" cy="156" r="5"/>
          <circle class="art-core" cx="135" cy="135" r="3"/>
          <text x="102" y="252">FIELD → FORM → FLUID</text>
        </svg>
      </div>
    </section>

    <div class="home-method" aria-label="How each lesson works">
      <span class="method-label">EACH IDEA, FOUR PASSES</span>
      <span class="method-step"><b>01</b> See it</span>
      <span class="method-step"><b>02</b> Write it</span>
      <span class="method-step"><b>03</b> Test it</span>
      <span class="method-step"><b>04</b> Use it</span>
    </div>

    <section aria-labelledby="roadmapTitle">
      <div class="home-section-heading">
        <div><div class="home-section-eyebrow">YOUR COURSE MAP</div><h2 id="roadmapTitle">From a symbol to a simulation.</h2></div>
        <p>Go in order for a gentle rebuild, or jump straight to the idea you need for a paper.</p>
      </div>
      <div class="unit-grid">
        ${units.map((unit, unitIndex) => {
          const lessonList = allLessons.filter((lesson) => lesson.unitIndex === unitIndex);
          const finished = lessonList.filter((lesson) => completedLessons.has(lesson.id)).length;
          return `<article class="unit-card">
            <span class="unit-card-accent" aria-hidden="true"></span>
            <div class="unit-card-top"><span class="unit-card-index">CHAPTER 0${unitIndex + 1}</span><span class="unit-card-count">${finished}/${lessonList.length} complete</span></div>
            <h3>${escapeText(unit.title)}</h3>
            <p class="unit-card-description">${escapeText(unit.description)}</p>
            <div class="unit-card-lessons">
              ${lessonList.map((lesson) => `<button class="home-lesson-link" type="button" data-lesson="${lesson.id}">
                <span class="home-lesson-number">${String(lesson.globalNumber).padStart(2, '0')}</span>
                <span class="home-lesson-name">${escapeText(lesson.title)}</span>
                <span class="home-lesson-status" aria-label="${completedLessons.has(lesson.id) ? 'Complete' : 'Not complete'}">${completedLessons.has(lesson.id) ? '✓' : '↗'}</span>
              </button>`).join('')}
            </div>
          </article>`;
        }).join('')}
      </div>
    </section>

    <section class="application-strip" aria-labelledby="applicationTitle">
      <div class="application-strip-top"><div class="home-section-eyebrow">WHERE THE MATH GOES</div><span class="unit-card-count">PRACTICE, NOT JUST PROOFS</span></div>
      <h2 id="applicationTitle">One toolkit. Two worlds.</h2>
      <div class="application-stages">
        <div class="application-stage"><span>01 · FIELD LANGUAGE</span><b>Derivatives · ∇ · units</b><i>∇</i></div>
        <div class="application-stage"><span>02 · FLUID MOTION</span><b>Advection · pressure · CFL</b><i>↗</i></div>
        <div class="application-stage"><span>03 · LIGHT TRANSPORT</span><b>Maxwell · rays · volumes</b><i>◌</i></div>
      </div>
    </section>
    <p class="home-signoff">Built for the moment you recognise a formula but want to understand what it is saying.</p>
  </div>`;
}

function renderLessonPage(lesson) {
  const unit = units[lesson.unitIndex];
  const previous = allLessons[lesson.index - 1] || null;
  const next = allLessons[lesson.index + 1] || null;
  const isComplete = completedLessons.has(lesson.id);
  const completedLabel = isComplete ? 'Completed ✓' : 'Mark lesson complete';
  const symbols = lesson.symbols.map((item) => `<div class="symbol-item"><span class="symbol-token">${item.token}</span><span class="symbol-description">${item.text}</span></div>`).join('');
  const termExplorer = lesson.terms ? `<div class="term-explorer-label">${lesson.termsIntro}</div><div class="term-explorer" role="group" aria-label="Explore the equation terms">${lesson.terms.map((term, i) => `<button class="term-chip" type="button" data-term="${i}" aria-pressed="${i === 0}">${term.label}</button>`).join('')}</div><div class="term-detail" id="termDetail" aria-live="polite">${lesson.terms[0].detail}</div>` : '';
  const experiment = renderExperiment(lesson);
  const fieldLabLink = lesson.lab === 'field' ? `<button class="lab-link" type="button" data-action="show-field-lab">Open the field lab on the right <span aria-hidden="true">↗</span></button>` : '';
  const prevButton = `<button class="lesson-nav-button" type="button" data-lesson="${previous ? previous.id : ''}" ${previous ? '' : 'disabled'} aria-label="${previous ? `Previous lesson: ${escapeText(previous.title)}` : 'No previous lesson'}"><span class="lesson-nav-arrow" aria-hidden="true">←</span><span class="lesson-nav-label"><small>PREVIOUS</small><strong>${previous ? escapeText(previous.title) : 'Course start'}</strong></span></button>`;
  const nextButton = `<button class="lesson-nav-button lesson-nav-next" type="button" data-lesson="${next ? next.id : ''}" ${next ? '' : 'disabled'} aria-label="${next ? `Next lesson: ${escapeText(next.title)}` : 'End of course'}"><span class="lesson-nav-label"><small>${next ? 'NEXT LESSON' : 'COURSE COMPLETE'}</small><strong>${next ? escapeText(next.title) : 'You made it through'}</strong></span><span class="lesson-nav-arrow" aria-hidden="true">→</span></button>`;

  return `<article class="lesson-page" aria-labelledby="lessonTitle">
    <div class="lesson-breadcrumb"><span>FIELDWORK</span><span class="crumb-sep">/</span><span>CHAPTER 0${lesson.unitIndex + 1}</span><span class="crumb-sep">/</span><span class="crumb-current">${escapeText(unit.shortTitle)}</span></div>
    <header class="lesson-heading">
      <div class="lesson-meta"><span class="lesson-kicker">LESSON ${String(lesson.globalNumber).padStart(2, '0')}</span><span class="lesson-number-pill">${escapeText(unit.shortTitle)}</span><span class="lesson-duration">${escapeText(lesson.duration)}</span></div>
      <h1 id="lessonTitle">${escapeText(lesson.title)}</h1>
      <p class="lesson-deck">${lesson.deck}</p>
    </header>
    <div class="lesson-objective"><span class="objective-mark" aria-hidden="true">◎</span><div><b>By the end, you’ll be able to</b><p>${lesson.aim}</p></div></div>

    <section class="lesson-section" aria-labelledby="intuitionTitle">
      <div class="section-eyebrow">01 — BUILD THE INTUITION</div>
      <h2 id="intuitionTitle">${lesson.intuitionTitle}</h2>
      <p>${lesson.intuition}</p>
      <div class="intuition-callout"><span class="callout-symbol" aria-hidden="true">↳</span><span>${lesson.analogy}</span></div>
    </section>

    <section class="lesson-section" aria-labelledby="equationHeading">
      <div class="section-eyebrow">02 — READ THE EQUATION</div>
      <div class="equation-card">
        <div class="equation-topline"><span id="equationHeading">THE COMPACT FORM</span><span class="equation-tag">${lesson.formulaTag}</span></div>
        <div class="equation-expression" role="math" aria-label="${escapeText(lesson.formula.replace(/\n/g, ', '))}">${lesson.formula}</div>
        <p class="equation-note">${lesson.formulaNote}</p>
        ${termExplorer}
      </div>
      <div class="symbols-heading">NAME EACH PIECE</div>
      <div class="symbol-grid">${symbols}</div>
      <div class="worked-example">
        <div class="worked-example-main"><h3>${lesson.workedHeading}</h3><p>${lesson.worked}</p></div>
        <div class="worked-math">${escapeText(lesson.workedMath)}</div>
      </div>
      <div class="paper-bridge"><span class="paper-bridge-mark" aria-hidden="true">↗</span><div><strong>When this appears in a paper</strong><p>${lesson.paperBridge}</p></div></div>
      ${fieldLabLink}
    </section>

    ${experiment}

    <section class="lesson-practice" aria-labelledby="practiceTitle">
      <div class="practice-heading"><span class="practice-icon" aria-hidden="true">?</span><div><div class="section-eyebrow">04 — CHECK YOUR UNDERSTANDING</div><h2 id="practiceTitle">Make the idea yours.</h2></div></div>
      <p class="practice-question">${lesson.quiz.question}</p>
      <div class="quiz-options" role="group" aria-label="Answer choices">
        ${lesson.quiz.options.map((option, i) => `<button class="quiz-option" type="button" data-quiz-index="${i}" aria-pressed="false"><span class="choice-key">${String.fromCharCode(65 + i)}</span><span class="choice-text">${option}</span><span class="choice-check" aria-hidden="true">✓</span></button>`).join('')}
      </div>
      <p class="quiz-feedback" id="quizFeedback" aria-live="polite">Choose an answer; the reasoning matters more than the letter.</p>
      <details class="challenge-reveal"><summary>Try one more, then reveal a worked answer</summary><p><strong>Try this:</strong> ${lesson.challenge}<br><strong>Worked answer:</strong> ${lesson.challengeAnswer}</p></details>
    </section>

    <nav class="lesson-navigation" aria-label="Lesson navigation">
      ${prevButton}
      <button class="complete-button${isComplete ? ' is-complete' : ''}" type="button" data-action="toggle-complete" aria-pressed="${isComplete}">${completedLabel}</button>
      ${nextButton}
    </nav>
    <p class="lesson-end-note">Your progress is saved in this browser. Come back whenever you need a refresher.</p>
  </article>`;
}

function renderExperiment(lesson) {
  if (lesson.lab === 'derivative') {
    return `<section class="lesson-experiment" aria-labelledby="experimentTitle">
      <div class="experiment-header"><div><div class="section-eyebrow">03 — PLAY WITH THE MATH</div><h3 id="experimentTitle">Drag the point. Watch the slope.</h3><p>Move along f(x) = sin(x). The tangent slope is the derivative; the two-neighbour estimate is what a grid can calculate.</p></div><span class="experiment-tag">LIVE GRAPH</span></div>
      <div class="lesson-chart-wrap"><canvas id="lessonChart" class="lesson-chart" aria-label="Sine curve and tangent line at the selected x position"></canvas></div>
      <div class="experiment-legend"><span class="legend-item"><i class="legend-swatch"></i> f(x) = sin(x)</span><span class="legend-item"><i class="legend-swatch coral"></i> tangent at x</span></div>
      <div class="experiment-controls"><label class="experiment-control" for="xSlider"><span>Position x (radians)</span><output id="xValue" for="xSlider">0.80</output><input id="xSlider" type="range" min="-314" max="314" value="80" step="1"></label></div>
      <div class="experiment-readout"><div class="experiment-stat"><span>EXACT SLOPE · cos(x)</span><strong id="slopeValue">0.70</strong></div><div class="experiment-stat"><span>CENTRAL DIFFERENCE</span><strong id="finiteDifferenceValue">0.69</strong></div></div>
    </section>`;
  }
  if (lesson.lab === 'integral') {
    return `<section class="lesson-experiment" aria-labelledby="experimentTitle">
      <div class="experiment-header"><div><div class="section-eyebrow">03 — PLAY WITH THE MATH</div><h3 id="experimentTitle">Approximate the optical depth.</h3><p>The curve is extinction along a one-metre ray. Midpoint rectangles estimate τ = ∫σₜ ds; transmittance is e<sup>−τ</sup>.</p></div><span class="experiment-tag">RIEMANN SUM</span></div>
      <div class="lesson-chart-wrap"><canvas id="lessonChart" class="lesson-chart" aria-label="Extinction curve with midpoint integration rectangles"></canvas></div>
      <div class="experiment-legend"><span class="legend-item"><i class="legend-swatch"></i> extinction σₜ(s)</span><span class="legend-item"><i class="legend-swatch coral"></i> sample rectangles</span></div>
      <div class="experiment-controls"><label class="experiment-control" for="sampleSlider"><span>Ray samples</span><output id="sampleValue" for="sampleSlider">12</output><input id="sampleSlider" type="range" min="3" max="36" value="12" step="1"></label></div>
      <div class="experiment-readout"><div class="experiment-stat"><span>OPTICAL DEPTH · τ</span><strong id="opticalDepthValue">—</strong></div><div class="experiment-stat"><span>TRANSMITTANCE · e⁻ᵗ</span><strong id="transmittanceValue">—</strong></div></div>
    </section>`;
  }
  if (lesson.lab === 'advection') {
    return `<section class="lesson-experiment" aria-labelledby="experimentTitle">
      <div class="experiment-header"><div><div class="section-eyebrow">03 — PLAY WITH THE MATH</div><h3 id="experimentTitle">Move the dye. Trace it back.</h3><p>A smooth dye blob rides in a constant 1D flow. The dashed curve is its starting shape; the solid curve is where it has travelled.</p></div><span class="experiment-tag">ADVECTION</span></div>
      <div class="lesson-chart-wrap"><canvas id="lessonChart" class="lesson-chart" aria-label="One-dimensional dye density at its starting point and after advection"></canvas></div>
      <div class="experiment-legend"><span class="legend-item"><i class="legend-swatch dashed"></i> starting dye</span><span class="legend-item"><i class="legend-swatch"></i> transported dye</span></div>
      <div class="experiment-controls">
        <label class="experiment-control" for="velocitySlider"><span>Flow speed u</span><output id="velocityValue" for="velocitySlider">0.60 m/s</output><input id="velocitySlider" type="range" min="-150" max="150" value="60" step="1"></label>
        <label class="experiment-control" for="timeSlider"><span>Elapsed time</span><output id="timeValue" for="timeSlider">0.40 s</output><input id="timeSlider" type="range" min="0" max="100" value="40" step="1"></label>
      </div>
      <div class="experiment-readout"><div class="experiment-stat"><span>DYE CENTRE</span><strong id="dyePositionValue">—</strong></div><div class="experiment-stat"><span>BACKTRACE FROM x</span><strong id="backtraceValue">x − uΔt</strong></div></div>
    </section>`;
  }
  if (lesson.lab === 'volume') {
    return `<section class="lesson-experiment" aria-labelledby="experimentTitle">
      <div class="experiment-header"><div><div class="section-eyebrow">03 — PLAY WITH THE MATH</div><h3 id="experimentTitle">March through a little cloud.</h3><p>Raise extinction or change the number of samples. Light is accumulated front to back while the remaining transmittance falls along the ray.</p></div><span class="experiment-tag">VOLUME RAY</span></div>
      <div class="lesson-chart-wrap"><canvas id="lessonChart" class="lesson-chart" aria-label="Volume ray samples and cumulative transmittance through a cloud"></canvas></div>
      <div class="experiment-legend"><span class="legend-item"><i class="legend-swatch coral"></i> density along ray</span><span class="legend-item"><i class="legend-swatch"></i> remaining transmittance</span></div>
      <div class="experiment-controls">
        <label class="experiment-control" for="extinctionSlider"><span>Extinction σₜ</span><output id="extinctionValue" for="extinctionSlider">1.60 m⁻¹</output><input id="extinctionSlider" type="range" min="20" max="400" value="160" step="5"></label>
        <label class="experiment-control" for="volumeSamplesSlider"><span>Ray samples</span><output id="volumeSamplesValue" for="volumeSamplesSlider">12</output><input id="volumeSamplesSlider" type="range" min="4" max="32" value="12" step="1"></label>
      </div>
      <div class="experiment-readout"><div class="experiment-stat"><span>OPTICAL DEPTH · τ</span><strong id="volumeTauValue">—</strong></div><div class="experiment-stat"><span>LIGHT LEFT · T</span><strong id="volumeTransValue">—</strong></div><div class="experiment-stat"><span>ACCUMULATED ALPHA</span><strong id="volumeAlphaValue">—</strong></div></div>
    </section>`;
  }
  return '';
}

function renderApp() {
  renderNavigation();
  renderProgress();
  if (currentLessonId && lessonById.has(currentLessonId)) {
    const lesson = lessonById.get(currentLessonId);
    courseContent.innerHTML = renderLessonPage(lesson);
    activeQuizAnswer = null;
    if (lesson.fieldMode) setFieldMode(lesson.fieldMode, false);
    drawLessonLab();
    courseContent.focus({ preventScroll: true });
  } else {
    courseContent.innerHTML = homeMarkup();
    activeQuizAnswer = null;
    courseContent.focus({ preventScroll: true });
  }
}

function navigateToLesson(id) {
  if (!lessonById.has(id)) return;
  currentLessonId = id;
  savedState.lastLesson = id;
  persistState();
  renderApp();
  closeMobileNav();
  history.replaceState(null, '', `#${encodeURIComponent(id)}`);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function goHome() {
  currentLessonId = null;
  renderApp();
  closeMobileNav();
  history.replaceState(null, '', '#course');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function toggleComplete() {
  if (!currentLessonId) return;
  if (completedLessons.has(currentLessonId)) {
    completedLessons.delete(currentLessonId);
    showToast('Lesson marked as not complete. Your other progress is safe.');
  } else {
    completedLessons.add(currentLessonId);
    showToast(completedLessons.size === TOTAL ? 'Course complete — you rebuilt the toolkit. Go use it.' : 'Lesson saved as complete. Nice work.');
  }
  persistState();
  renderApp();
}

function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('is-visible');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 2800);
}

function chooseQuizAnswer(button) {
  const lesson = lessonById.get(currentLessonId);
  if (!lesson || !lesson.quiz) return;
  const chosen = Number(button.dataset.quizIndex);
  activeQuizAnswer = chosen;
  const options = [...courseContent.querySelectorAll('.quiz-option')];
  const feedback = document.getElementById('quizFeedback');
  options.forEach((option, i) => {
    option.classList.remove('is-correct', 'is-wrong');
    option.setAttribute('aria-pressed', String(i === chosen));
    if (i === lesson.quiz.correct) option.classList.add('is-correct');
  });
  if (chosen === lesson.quiz.correct) {
    feedback.innerHTML = `<strong>That’s it.</strong> ${lesson.quiz.explanation}`;
    feedback.className = 'quiz-feedback is-correct';
  } else {
    button.classList.add('is-wrong');
    feedback.innerHTML = `<strong>Not quite—follow the quantities.</strong> ${lesson.quiz.explanation}`;
    feedback.className = 'quiz-feedback is-wrong';
  }
}

function selectTerm(button) {
  const lesson = lessonById.get(currentLessonId);
  if (!lesson || !lesson.terms) return;
  const index = Number(button.dataset.term);
  lesson.terms.forEach((_, i) => {
    const chip = courseContent.querySelector(`[data-term="${i}"]`);
    if (chip) chip.setAttribute('aria-pressed', String(i === index));
  });
  const detail = document.getElementById('termDetail');
  if (detail && lesson.terms[index]) detail.innerHTML = lesson.terms[index].detail;
}

function setFieldMode(mode, redraw = true) {
  if (!['source', 'swirl', 'saddle'].includes(mode)) return;
  fieldState.mode = mode;
  document.querySelectorAll('.field-mode').forEach((button) => {
    const active = button.dataset.fieldMode === mode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  const strength = fieldState.strength;
  const descriptions = {
    source: `A source: arrows spread outward. Positive divergence, no local spin. Toy-field divergence: ${formatSigned(2 * strength)}.`,
    swirl: `A swirl: arrows circle around. Zero divergence, positive z-curl: ${formatSigned(2 * strength)}.`,
    saddle: 'A saddle: the field stretches in x and contracts in y. Zero divergence and zero curl in this idealized field.'
  };
  document.getElementById('fieldCaption').textContent = descriptions[mode];
  const divValue = mode === 'source' ? 2 * strength : 0;
  const curlValue = mode === 'swirl' ? 2 * strength : 0;
  document.getElementById('divergenceReadout').textContent = formatSigned(divValue);
  document.getElementById('curlReadout').textContent = formatSigned(curlValue);
  if (redraw) drawFieldCanvas();
}

function formatSigned(value) {
  if (Math.abs(value) < 0.005) return '0.00';
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}`;
}

function updateFieldStrength() {
  const slider = document.getElementById('fieldIntensity');
  fieldState.strength = Number(slider.value) / 100;
  document.getElementById('intensityValue').textContent = fieldState.strength.toFixed(2);
  setFieldMode(fieldState.mode);
}

function setupCanvas(canvas, fallbackHeight) {
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(10, rect.width || canvas.clientWidth || 380);
  const height = Math.max(10, rect.height || canvas.clientHeight || fallbackHeight || 200);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const pixelWidth = Math.round(width * dpr);
  const pixelHeight = Math.round(height * dpr);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width, height };
}

function drawArrow(ctx, x1, y1, x2, y2, color) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy);
  if (length < 1.5) return;
  const angle = Math.atan2(dy, dx);
  const head = Math.min(5, Math.max(3, length * .26));
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2 - Math.cos(angle) * head * .55, y2 - Math.sin(angle) * head * .55);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - Math.cos(angle - .55) * head, y2 - Math.sin(angle - .55) * head);
  ctx.lineTo(x2 - Math.cos(angle + .55) * head, y2 - Math.sin(angle + .55) * head);
  ctx.closePath();
  ctx.fill();
}

function drawFieldCanvas() {
  const canvas = document.getElementById('fieldCanvas');
  const size = setupCanvas(canvas, 172);
  if (!size) return;
  const { ctx, width, height } = size;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#17231b';
  ctx.fillRect(0, 0, width, height);
  const cx = width / 2;
  const cy = height / 2;
  const scale = Math.min(width, height) * .36;
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#2a392e';
  for (let i = -2; i <= 2; i++) {
    const x = cx + i * scale / 2;
    const y = cy + i * scale / 2;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
  }
  ctx.strokeStyle = '#596f5c';
  ctx.lineWidth = 1.1;
  ctx.beginPath(); ctx.moveTo(7, cy); ctx.lineTo(width - 8, cy); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx, 7); ctx.lineTo(cx, height - 8); ctx.stroke();
  const colors = { source: '#ef987e', swirl: '#8ed3aa', saddle: '#a5b6e2' };
  const color = colors[fieldState.mode];
  const step = Math.max(.3, Math.min(.42, 30 / scale));
  for (let y = -.9; y <= .91; y += step) {
    for (let x = -.9; x <= .91; x += step) {
      let vx = 0; let vy = 0;
      if (fieldState.mode === 'source') { vx = x; vy = y; }
      if (fieldState.mode === 'swirl') { vx = -y; vy = x; }
      if (fieldState.mode === 'saddle') { vx = x; vy = -y; }
      vx *= fieldState.strength;
      vy *= fieldState.strength;
      const px = cx + x * scale;
      const py = cy - y * scale;
      const factor = scale * .23;
      drawArrow(ctx, px, py, px + vx * factor, py - vy * factor, color);
    }
  }
  ctx.fillStyle = '#dcebd5';
  ctx.beginPath(); ctx.arc(cx, cy, 2.4, 0, Math.PI * 2); ctx.fill();
}

function drawGrid(ctx, width, height, pad, xTicks = 4, yTicks = 3) {
  ctx.fillStyle = '#14271f';
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = 'rgba(219,236,213,.09)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= xTicks; i++) {
    const x = pad.left + (width - pad.left - pad.right) * (i / xTicks);
    ctx.beginPath(); ctx.moveTo(x, pad.top); ctx.lineTo(x, height - pad.bottom); ctx.stroke();
  }
  for (let j = 0; j <= yTicks; j++) {
    const y = pad.top + (height - pad.top - pad.bottom) * (j / yTicks);
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(width - pad.right, y); ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(225,239,220,.35)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(pad.left, height - pad.bottom); ctx.lineTo(width - pad.right, height - pad.bottom); ctx.stroke();
}

function drawLessonLab() {
  const lesson = lessonById.get(currentLessonId);
  if (!lesson || !lesson.lab || lesson.lab === 'field') return;
  if (lesson.lab === 'derivative') drawDerivativeLab();
  if (lesson.lab === 'integral') drawIntegralLab();
  if (lesson.lab === 'advection') drawAdvectionLab();
  if (lesson.lab === 'volume') drawVolumeLab();
}

function drawDerivativeLab() {
  const size = setupCanvas(document.getElementById('lessonChart'), 210);
  if (!size) return;
  const { ctx, width, height } = size;
  const pad = { left: 34, right: 14, top: 18, bottom: 25 };
  drawGrid(ctx, width, height, pad, 4, 4);
  const xmin = -Math.PI; const xmax = Math.PI; const ymin = -1.45; const ymax = 1.45;
  const px = (x) => pad.left + (x - xmin) / (xmax - xmin) * (width - pad.left - pad.right);
  const py = (y) => pad.top + (ymax - y) / (ymax - ymin) * (height - pad.top - pad.bottom);
  ctx.fillStyle = '#a2b4a4'; ctx.font = '9px monospace'; ctx.textAlign = 'center';
  ['−π', '−π/2', '0', 'π/2', 'π'].forEach((label, i) => {
    const x = pad.left + (width - pad.left - pad.right) * i / 4;
    ctx.fillText(label, x, height - 8);
  });
  ctx.textAlign = 'left';
  const x = Number(document.getElementById('xSlider').value) / 100;
  const y0 = Math.sin(x);
  const slope = Math.cos(x);
  const h = .25;
  const central = (Math.sin(x + h) - Math.sin(x - h)) / (2 * h);
  ctx.save();
  ctx.beginPath(); ctx.rect(pad.left, pad.top, width - pad.left - pad.right, height - pad.top - pad.bottom); ctx.clip();
  ctx.beginPath();
  for (let i = 0; i <= 180; i++) {
    const sampleX = xmin + (xmax - xmin) * i / 180;
    const sampleY = Math.sin(sampleX);
    if (i === 0) ctx.moveTo(px(sampleX), py(sampleY)); else ctx.lineTo(px(sampleX), py(sampleY));
  }
  ctx.strokeStyle = '#c8e99e'; ctx.lineWidth = 2; ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(px(xmin), py(y0 + slope * (xmin - x)));
  ctx.lineTo(px(xmax), py(y0 + slope * (xmax - x)));
  ctx.strokeStyle = '#ef987e'; ctx.lineWidth = 1.4; ctx.stroke();
  ctx.beginPath(); ctx.arc(px(x), py(y0), 4, 0, Math.PI * 2); ctx.fillStyle = '#fff5e9'; ctx.fill();
  ctx.strokeStyle = '#ef987e'; ctx.lineWidth = 2; ctx.stroke();
  ctx.restore();
  document.getElementById('xValue').textContent = x.toFixed(2);
  document.getElementById('slopeValue').textContent = slope.toFixed(2);
  document.getElementById('finiteDifferenceValue').textContent = central.toFixed(2);
}

function extinction(s) {
  return .25 + 1.55 * Math.exp(-Math.pow((s - .56) / .19, 2));
}

function integrateExtinction(samples) {
  const ds = 1 / samples;
  let sum = 0;
  for (let i = 0; i < samples; i++) sum += extinction((i + .5) * ds) * ds;
  return sum;
}

function drawIntegralLab() {
  const size = setupCanvas(document.getElementById('lessonChart'), 210);
  if (!size) return;
  const { ctx, width, height } = size;
  const pad = { left: 34, right: 13, top: 17, bottom: 25 };
  drawGrid(ctx, width, height, pad, 5, 4);
  const xmin = 0; const xmax = 1; const ymax = 2.1;
  const px = (x) => pad.left + x * (width - pad.left - pad.right);
  const py = (y) => height - pad.bottom - (y / ymax) * (height - pad.top - pad.bottom);
  const samples = Number(document.getElementById('sampleSlider').value);
  const ds = 1 / samples;
  ctx.save();
  ctx.beginPath(); ctx.rect(pad.left, pad.top, width - pad.left - pad.right, height - pad.top - pad.bottom); ctx.clip();
  for (let i = 0; i < samples; i++) {
    const mid = (i + .5) * ds;
    const value = extinction(mid);
    ctx.fillStyle = 'rgba(239,152,126,.34)';
    ctx.fillRect(px(i * ds), py(value), px((i + 1) * ds) - px(i * ds), height - pad.bottom - py(value));
  }
  ctx.beginPath();
  for (let i = 0; i <= 160; i++) {
    const x = i / 160;
    const y = extinction(x);
    if (i === 0) ctx.moveTo(px(x), py(y)); else ctx.lineTo(px(x), py(y));
  }
  ctx.strokeStyle = '#c8e99e'; ctx.lineWidth = 2; ctx.stroke();
  for (let i = 0; i < samples; i++) {
    const x = (i + .5) * ds;
    ctx.beginPath(); ctx.arc(px(x), py(extinction(x)), 2.2, 0, Math.PI * 2); ctx.fillStyle = '#ef987e'; ctx.fill();
  }
  ctx.restore();
  ctx.fillStyle = '#a2b4a4'; ctx.font = '9px monospace'; ctx.textAlign = 'center';
  ctx.fillText('0 m', px(0), height - 8); ctx.fillText('0.5 m', px(.5), height - 8); ctx.fillText('1 m', px(1), height - 8);
  const tau = integrateExtinction(samples);
  const transmittance = Math.exp(-tau);
  document.getElementById('sampleValue').textContent = String(samples);
  document.getElementById('opticalDepthValue').textContent = tau.toFixed(3);
  document.getElementById('transmittanceValue').textContent = transmittance.toFixed(3);
}

function drawAdvectionLab() {
  const size = setupCanvas(document.getElementById('lessonChart'), 210);
  if (!size) return;
  const { ctx, width, height } = size;
  const pad = { left: 34, right: 13, top: 17, bottom: 25 };
  drawGrid(ctx, width, height, pad, 4, 4);
  const xmin = -1; const xmax = 1; const ymax = 1.15;
  const px = (x) => pad.left + (x - xmin) / (xmax - xmin) * (width - pad.left - pad.right);
  const py = (y) => height - pad.bottom - (y / ymax) * (height - pad.top - pad.bottom);
  const velocity = Number(document.getElementById('velocitySlider').value) / 100;
  const time = Number(document.getElementById('timeSlider').value) / 100;
  const originalCenter = -.45;
  const center = originalCenter + velocity * time;
  const sigma = .17;
  const q = (x, c) => Math.exp(-Math.pow((x - c) / sigma, 2));
  ctx.save();
  ctx.beginPath(); ctx.rect(pad.left, pad.top, width - pad.left - pad.right, height - pad.top - pad.bottom); ctx.clip();
  ctx.beginPath();
  for (let i = 0; i <= 180; i++) {
    const x = xmin + (xmax - xmin) * i / 180;
    const y = q(x, originalCenter);
    if (i === 0) ctx.moveTo(px(x), py(y)); else ctx.lineTo(px(x), py(y));
  }
  ctx.setLineDash([5, 4]); ctx.strokeStyle = '#ef987e'; ctx.lineWidth = 1.4; ctx.stroke(); ctx.setLineDash([]);
  ctx.beginPath();
  for (let i = 0; i <= 180; i++) {
    const x = xmin + (xmax - xmin) * i / 180;
    const y = q(x, center);
    if (i === 0) ctx.moveTo(px(x), py(y)); else ctx.lineTo(px(x), py(y));
  }
  ctx.strokeStyle = '#c8e99e'; ctx.lineWidth = 2; ctx.stroke();
  ctx.restore();
  ctx.fillStyle = '#a2b4a4'; ctx.font = '9px monospace'; ctx.textAlign = 'center';
  ctx.fillText('−1', px(-1), height - 8); ctx.fillText('0', px(0), height - 8); ctx.fillText('1', px(1), height - 8);
  document.getElementById('velocityValue').textContent = `${velocity.toFixed(2)} m/s`;
  document.getElementById('timeValue').textContent = `${time.toFixed(2)} s`;
  document.getElementById('dyePositionValue').textContent = `${center.toFixed(2)} m`;
  document.getElementById('backtraceValue').textContent = `${(center - velocity * time).toFixed(2)} m`;
}

function drawVolumeLab() {
  const size = setupCanvas(document.getElementById('lessonChart'), 210);
  if (!size) return;
  const { ctx, width, height } = size;
  ctx.fillStyle = '#14271f'; ctx.fillRect(0, 0, width, height);
  const padLeft = 29; const padRight = 12;
  const plotWidth = width - padLeft - padRight;
  const topY = 28; const cloudBottom = 106; const graphTop = 128; const graphBottom = height - 25;
  const samples = Number(document.getElementById('volumeSamplesSlider').value);
  const sigma = Number(document.getElementById('extinctionSlider').value) / 100;
  const ds = 1 / samples;
  let tau = 0; let transmittance = 1;
  const steps = [];
  for (let i = 0; i < samples; i++) {
    const s = (i + .5) * ds;
    const density = .12 + .88 * Math.exp(-Math.pow((s - .57) / .22, 2));
    const localTau = sigma * density * ds;
    const alpha = 1 - Math.exp(-localTau);
    const before = transmittance;
    transmittance *= 1 - alpha;
    tau += localTau;
    steps.push({ s, density, alpha, before, after: transmittance });
  }
  ctx.fillStyle = '#a2b4a4'; ctx.font = '8px monospace'; ctx.textAlign = 'left'; ctx.fillText('RAY →', padLeft, 14);
  ctx.fillText('DENSITY', 7, 69); ctx.fillText('LIGHT LEFT', 2, graphTop + 5);
  ctx.fillStyle = 'rgba(236,145,119,.1)'; ctx.fillRect(padLeft, topY, plotWidth, cloudBottom - topY);
  ctx.strokeStyle = 'rgba(219,236,213,.12)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(padLeft, cloudBottom); ctx.lineTo(width - padRight, cloudBottom); ctx.stroke();
  const cellW = plotWidth / samples;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const barHeight = step.density * (cloudBottom - topY) * .78;
    ctx.fillStyle = `rgba(239,152,126,${.18 + step.density * .68})`;
    ctx.fillRect(padLeft + i * cellW + 1, cloudBottom - barHeight, Math.max(1, cellW - 2), barHeight);
    ctx.fillStyle = '#e9b3a0'; ctx.beginPath(); ctx.arc(padLeft + (i + .5) * cellW, cloudBottom + 1, 2.2, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = '#a2b4a4'; ctx.textAlign = 'center';
  ctx.fillText('front of cloud', padLeft, cloudBottom + 16); ctx.fillText('back', width - padRight, cloudBottom + 16);
  ctx.strokeStyle = 'rgba(219,236,213,.1)';
  for (let i = 0; i <= 2; i++) {
    const y = graphTop + i * (graphBottom - graphTop) / 2;
    ctx.beginPath(); ctx.moveTo(padLeft, y); ctx.lineTo(width - padRight, y); ctx.stroke();
  }
  const transY = (value) => graphBottom - value * (graphBottom - graphTop);
  ctx.beginPath();
  steps.forEach((step, i) => {
    const x = padLeft + (i / samples) * plotWidth;
    const y = transY(step.before);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    ctx.lineTo(padLeft + ((i + 1) / samples) * plotWidth, transY(step.after));
  });
  ctx.strokeStyle = '#c8e99e'; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = '#a2b4a4'; ctx.textAlign = 'right'; ctx.fillText('1', padLeft - 5, graphTop + 3); ctx.fillText('0', padLeft - 5, graphBottom + 3);
  const totalAlpha = 1 - transmittance;
  document.getElementById('extinctionValue').textContent = `${sigma.toFixed(2)} m⁻¹`;
  document.getElementById('volumeSamplesValue').textContent = String(samples);
  document.getElementById('volumeTauValue').textContent = tau.toFixed(3);
  document.getElementById('volumeTransValue').textContent = transmittance.toFixed(3);
  document.getElementById('volumeAlphaValue').textContent = totalAlpha.toFixed(3);
}

function openDecoder(button) {
  lastFocusedElement = button || document.activeElement;
  decoderDialog.hidden = false;
  document.body.style.overflow = 'hidden';
  const closeButton = decoderDialog.querySelector('.dialog-close');
  if (closeButton) closeButton.focus();
}

function closeDecoder() {
  if (decoderDialog.hidden) return;
  decoderDialog.hidden = true;
  document.body.style.overflow = '';
  if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') lastFocusedElement.focus();
}

function openMobileNav() {
  sidebar.classList.add('is-open');
  sidebarBackdrop.hidden = false;
  document.getElementById('mobileMenu').setAttribute('aria-expanded', 'true');
}

function closeMobileNav() {
  sidebar.classList.remove('is-open');
  sidebarBackdrop.hidden = true;
  document.getElementById('mobileMenu').setAttribute('aria-expanded', 'false');
}

function handleClick(event) {
  const lessonButton = event.target.closest('[data-lesson]');
  if (lessonButton && !lessonButton.disabled) {
    const id = lessonButton.dataset.lesson;
    if (id) navigateToLesson(id);
    return;
  }
  const unitButton = event.target.closest('[data-unit-toggle]');
  if (unitButton) {
    const index = Number(unitButton.dataset.unitToggle);
    if (collapsedUnits.has(index)) collapsedUnits.delete(index); else collapsedUnits.add(index);
    const expanded = !collapsedUnits.has(index);
    unitButton.setAttribute('aria-expanded', String(expanded));
    const list = courseNav.querySelector(`[data-unit-lessons="${index}"]`);
    if (list) list.hidden = !expanded;
    return;
  }
  const actionButton = event.target.closest('[data-action]');
  if (actionButton) {
    const action = actionButton.dataset.action;
    if (action === 'home') goHome();
    if (action === 'start-first') navigateToLesson(allLessons[0].id);
    if (action === 'toggle-complete') toggleComplete();
    if (action === 'show-field-lab') {
      const lab = document.getElementById('fieldLab');
      if (lab) { lab.scrollIntoView({ behavior: 'smooth', block: 'center' }); lab.focus?.({ preventScroll: true }); }
    }
    if (action === 'close-decoder') closeDecoder();
    return;
  }
  const fieldModeButton = event.target.closest('[data-field-mode]');
  if (fieldModeButton) { setFieldMode(fieldModeButton.dataset.fieldMode); return; }
  const termButton = event.target.closest('[data-term]');
  if (termButton) { selectTerm(termButton); return; }
  const quizButton = event.target.closest('[data-quiz-index]');
  if (quizButton) { chooseQuizAnswer(quizButton); return; }
  const decoderButton = event.target.closest('.decoder-open');
  if (decoderButton) { openDecoder(decoderButton); return; }
}

document.addEventListener('click', handleClick);
document.getElementById('fieldIntensity').addEventListener('input', updateFieldStrength);
document.getElementById('mobileMenu').addEventListener('click', () => {
  if (sidebar.classList.contains('is-open')) closeMobileNav(); else openMobileNav();
});
sidebarBackdrop.addEventListener('click', closeMobileNav);
decoderDialog.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeDecoder();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeDecoder();
    closeMobileNav();
  }
});
courseContent.addEventListener('input', (event) => {
  if (event.target.id === 'xSlider' || event.target.id === 'sampleSlider' || event.target.id === 'velocitySlider' || event.target.id === 'timeSlider' || event.target.id === 'extinctionSlider' || event.target.id === 'volumeSamplesSlider') drawLessonLab();
});
window.addEventListener('resize', () => {
  window.requestAnimationFrame(() => { drawFieldCanvas(); drawLessonLab(); });
});

function initialLessonFromLocation() {
  const hash = decodeURIComponent(window.location.hash.replace(/^#/, ''));
  if (lessonById.has(hash)) return hash;
  if (hash === 'course') return null;
  return savedState.lastLesson;
}

currentLessonId = initialLessonFromLocation();
renderApp();
drawFieldCanvas();
