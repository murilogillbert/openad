import {
  destinoAposRecorte,
  eh16x9,
  ESPEC,
  perdaDoRecorte,
  recorteCentral16x9,
  validarCriativo,
} from '@/lib/criativo';

/**
 * A tela do veiculo e 16:9 em paisagem, no maximo 1920x1080.
 *
 * O servidor NAO checa proporcao — so `largura <= 1920 && altura <= 1080` — entao uma peca
 * 1920x600 passaria por ele e apareceria tarjada no tablete. A regra de 16:9 mora aqui, e e
 * por isso que ela precisa de teste: nao ha rede de seguranca do outro lado.
 *
 * O caso que motivou tudo: foto de celular 1080x2340, que o servidor recusou com
 * "Resolution 1080x2340 exceeds maximum 1920x1080" depois do upload inteiro.
 */

describe('eh16x9', () => {
  it('aceita as resolucoes 16:9 usuais', () => {
    for (const [l, a] of [
      [1920, 1080],
      [1280, 720],
      [960, 540],
      [640, 360],
    ]) {
      expect(eh16x9(l!, a!)).toBe(true);
    }
  });

  it('aceita arredondamento de encoder dentro da folga', () => {
    // Encoder de celular arredonda para multiplo de 2 ou 16; 1918x1080 e 16:9 na pratica.
    expect(eh16x9(1918, 1080)).toBe(true);
  });

  it('recusa vertical de celular e outras proporcoes', () => {
    expect(eh16x9(1080, 2340)).toBe(false);
    expect(eh16x9(1080, 1920)).toBe(false);
    expect(eh16x9(4000, 3000)).toBe(false);
    expect(eh16x9(1080, 1080)).toBe(false);
    expect(eh16x9(1920, 600)).toBe(false);
  });

  it('nao explode com dimensao zero', () => {
    expect(eh16x9(0, 0)).toBe(false);
    expect(eh16x9(1920, 0)).toBe(false);
  });
});

describe('validarCriativo', () => {
  it('aprova imagem 1920x1080', () => {
    expect(
      validarCriativo({ tipo: 'image/jpeg', largura: 1920, altura: 1080, bytes: 400_000 })
    ).toEqual({ ok: true });
  });

  it('aprova video 1920x1080 de 15 s', () => {
    expect(
      validarCriativo({
        tipo: 'video/mp4',
        largura: 1920,
        altura: 1080,
        duracaoSeg: 15,
        bytes: 10_000_000,
      })
    ).toEqual({ ok: true });
  });

  it('recusa o caso real: foto 1080x2340, e oferece ajuste', () => {
    const v = validarCriativo({
      tipo: 'image/jpeg',
      largura: 1080,
      altura: 2340,
      bytes: 400_000,
    });
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.motivo).toBe('proporcao');
    expect(v.ajustavel).toBe(true);
    expect(v.mensagem).toContain('1080×2340');
  });

  it('recusa video vertical e NAO oferece ajuste: o app nao recodifica', () => {
    const v = validarCriativo({
      tipo: 'video/mp4',
      largura: 1080,
      altura: 2340,
      duracaoSeg: 20,
      bytes: 44_600_000,
    });
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.motivo).toBe('proporcao');
    expect(v.ajustavel).toBe(false);
    expect(v.mensagem).toMatch(/export/i);
  });

  it('recusa imagem 16:9 acima do teto, com ajuste', () => {
    const v = validarCriativo({ tipo: 'image/jpeg', largura: 3840, altura: 2160 });
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.motivo).toBe('dimensao');
    expect(v.ajustavel).toBe(true);
  });

  it('recusa formato nao aceito', () => {
    const v = validarCriativo({ tipo: 'image/heic', largura: 1920, altura: 1080 });
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.motivo).toBe('tipo');
    expect(v.ajustavel).toBe(false);
  });

  it('recusa duracao fora da faixa de 10 a 120 s', () => {
    const curto = validarCriativo({
      tipo: 'video/mp4',
      largura: 1920,
      altura: 1080,
      duracaoSeg: 4,
    });
    expect(curto.ok).toBe(false);
    if (!curto.ok) expect(curto.motivo).toBe('duracao');

    const longo = validarCriativo({
      tipo: 'video/mp4',
      largura: 1920,
      altura: 1080,
      duracaoSeg: 200,
    });
    expect(longo.ok).toBe(false);
    if (!longo.ok) expect(longo.motivo).toBe('duracao');
  });

  it('recusa arquivo acima do limite de bytes', () => {
    const v = validarCriativo({
      tipo: 'video/mp4',
      largura: 1920,
      altura: 1080,
      duracaoSeg: 30,
      bytes: ESPEC.bytesMax + 1,
    });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.motivo).toBe('tamanho');
  });

  it('recusa quando a dimensao nao pudesse ser lida', () => {
    const v = validarCriativo({ tipo: 'image/png', largura: 0, altura: 0 });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.motivo).toBe('dimensao_desconhecida');
  });

  it('aprova 16:9 pequeno, mas avisa da resolucao baixa', () => {
    const v = validarCriativo({ tipo: 'image/jpeg', largura: 640, altura: 360 });
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.aviso).toMatch(/borrada/i);
  });

  it('a ordem das checagens poe tipo antes de dimensao', () => {
    // Um HEIC vertical tem dois problemas; a mensagem util e a do formato, porque e a que
    // o usuario resolve escolhendo outro arquivo.
    const v = validarCriativo({ tipo: 'image/heic', largura: 1080, altura: 2340 });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.motivo).toBe('tipo');
  });
});

describe('recorteCentral16x9', () => {
  it('corta em cima e embaixo numa origem vertical', () => {
    const r = recorteCentral16x9(1080, 2340);
    expect(r.width).toBe(1080);
    expect(r.height).toBe(608); // 1080 / (16/9) = 607,5 -> 608
    expect(r.originX).toBe(0);
    expect(r.originY).toBe(866);
    expect(eh16x9(r.width, r.height)).toBe(true);
  });

  it('corta nas laterais numa origem mais larga que 16:9', () => {
    const r = recorteCentral16x9(3000, 1000);
    expect(r.height).toBe(1000);
    expect(r.width).toBe(1778); // 1000 * 16/9 = 1777,8 -> 1778
    expect(r.originY).toBe(0);
    expect(r.originX).toBe(611);
    expect(eh16x9(r.width, r.height)).toBe(true);
  });

  it('nao recorta o que ja e 16:9', () => {
    const r = recorteCentral16x9(1920, 1080);
    expect(r).toEqual({ originX: 0, originY: 0, width: 1920, height: 1080 });
  });

  it('o recorte nunca sai dos limites da origem', () => {
    for (const [l, a] of [
      [1080, 2340],
      [4000, 3000],
      [3000, 1000],
      [1, 1],
      [1080, 1080],
      [4080, 3060],
    ]) {
      const r = recorteCentral16x9(l!, a!);
      expect(r.originX).toBeGreaterThanOrEqual(0);
      expect(r.originY).toBeGreaterThanOrEqual(0);
      expect(r.originX + r.width).toBeLessThanOrEqual(l!);
      expect(r.originY + r.height).toBeLessThanOrEqual(a!);
    }
  });
});

describe('destinoAposRecorte', () => {
  it('reduz quando o recorte passa do teto', () => {
    // Foto comum de celular 4000x3000: recorte 16:9 da 4000x2250, acima de 1920.
    const r = recorteCentral16x9(4000, 3000);
    expect(r.width).toBe(4000);
    expect(destinoAposRecorte(r)).toEqual({ width: 1920, height: 1080 });
  });

  it('nao amplia peca menor que o teto', () => {
    expect(destinoAposRecorte(recorteCentral16x9(1280, 720))).toBeNull();
  });

  it('o resultado final sempre cabe no teto do servidor', () => {
    for (const [l, a] of [
      [1080, 2340],
      [4000, 3000],
      [3840, 2160],
      [3000, 1000],
    ]) {
      const r = recorteCentral16x9(l!, a!);
      const d = destinoAposRecorte(r) ?? { width: r.width, height: r.height };
      expect(d.width).toBeLessThanOrEqual(ESPEC.larguraMax);
      expect(d.height).toBeLessThanOrEqual(ESPEC.alturaMax);
    }
  });
});

describe('perdaDoRecorte', () => {
  it('mede a area perdida, para a tela poder avisar', () => {
    expect(perdaDoRecorte(1920, 1080, recorteCentral16x9(1920, 1080))).toBe(0);
    // 1080x2340 -> 1080x608: sobra ~26% da area.
    expect(perdaDoRecorte(1080, 2340, recorteCentral16x9(1080, 2340))).toBe(74);
  });
});
