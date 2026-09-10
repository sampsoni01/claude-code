//! Small, dependency-free 2D simplex noise + fBm. Deterministic per seed.

#[derive(Clone)]
pub struct Simplex2 {
    perm: [u8; 512],
}

const GRAD: [[f32; 2]; 8] = [
    [1.0, 1.0],
    [-1.0, 1.0],
    [1.0, -1.0],
    [-1.0, -1.0],
    [1.0, 0.0],
    [-1.0, 0.0],
    [0.0, 1.0],
    [0.0, -1.0],
];

fn splitmix64(state: &mut u64) -> u64 {
    *state = state.wrapping_add(0x9E3779B97F4A7C15);
    let mut z = *state;
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58476D1CE4E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D049BB133111EB);
    z ^ (z >> 31)
}

impl Simplex2 {
    pub fn new(seed: u64) -> Self {
        let mut p: Vec<u8> = (0..=255).collect();
        let mut s = seed ^ 0xA5A5_5A5A_1234_9876;
        for i in (1..256).rev() {
            let j = (splitmix64(&mut s) % (i as u64 + 1)) as usize;
            p.swap(i, j);
        }
        let mut perm = [0u8; 512];
        for i in 0..512 {
            perm[i] = p[i & 255];
        }
        Self { perm }
    }

    #[inline]
    fn grad(&self, i: i32, j: i32) -> [f32; 2] {
        let idx = self.perm[(i & 255) as usize + self.perm[(j & 255) as usize] as usize] as usize & 7;
        GRAD[idx]
    }

    /// Noise in roughly [-1, 1].
    pub fn get(&self, x: f32, y: f32) -> f32 {
        const F2: f32 = 0.366_025_4; // (sqrt(3)-1)/2
        const G2: f32 = 0.211_324_87; // (3-sqrt(3))/6
        let s = (x + y) * F2;
        let i = (x + s).floor();
        let j = (y + s).floor();
        let t = (i + j) * G2;
        let x0 = x - (i - t);
        let y0 = y - (j - t);
        let (i1, j1) = if x0 > y0 { (1.0, 0.0) } else { (0.0, 1.0) };
        let x1 = x0 - i1 + G2;
        let y1 = y0 - j1 + G2;
        let x2 = x0 - 1.0 + 2.0 * G2;
        let y2 = y0 - 1.0 + 2.0 * G2;
        let ii = i as i32;
        let jj = j as i32;
        let mut n = 0.0;
        for (dx, dy, gi, gj) in [
            (x0, y0, ii, jj),
            (x1, y1, ii + i1 as i32, jj + j1 as i32),
            (x2, y2, ii + 1, jj + 1),
        ] {
            let t = 0.5 - dx * dx - dy * dy;
            if t > 0.0 {
                let g = self.grad(gi, gj);
                let t2 = t * t;
                n += t2 * t2 * (g[0] * dx + g[1] * dy);
            }
        }
        70.0 * n
    }

    /// Fractional Brownian motion, `octaves` layers, output roughly [-1, 1].
    pub fn fbm(&self, x: f32, y: f32, octaves: u32, lacunarity: f32, gain: f32) -> f32 {
        let mut amp = 1.0;
        let mut freq = 1.0;
        let mut sum = 0.0;
        let mut norm = 0.0;
        for _ in 0..octaves {
            sum += amp * self.get(x * freq, y * freq);
            norm += amp;
            amp *= gain;
            freq *= lacunarity;
        }
        sum / norm
    }

    /// Ridged multifractal, output in [0, 1].
    pub fn ridged(&self, x: f32, y: f32, octaves: u32, lacunarity: f32, gain: f32) -> f32 {
        let mut amp = 1.0;
        let mut freq = 1.0;
        let mut sum = 0.0;
        let mut norm = 0.0;
        let mut weight = 1.0f32;
        for _ in 0..octaves {
            let mut n = 1.0 - self.get(x * freq, y * freq).abs();
            n *= n;
            n *= weight;
            weight = (n * 2.0).clamp(0.0, 1.0);
            sum += n * amp;
            norm += amp;
            amp *= gain;
            freq *= lacunarity;
        }
        sum / norm
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deterministic_and_bounded() {
        let a = Simplex2::new(7);
        let b = Simplex2::new(7);
        let mut lo = f32::INFINITY;
        let mut hi = f32::NEG_INFINITY;
        for i in 0..2000 {
            let x = i as f32 * 0.137;
            let y = (i * 31 % 977) as f32 * 0.071;
            let v = a.get(x, y);
            assert_eq!(v, b.get(x, y));
            lo = lo.min(v);
            hi = hi.max(v);
        }
        assert!(lo >= -1.05 && hi <= 1.05, "range {lo}..{hi}");
        assert!(hi - lo > 0.5);
    }
}
