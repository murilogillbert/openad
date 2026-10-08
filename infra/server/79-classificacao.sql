-- Confere a tabela de classificação **gravada** contra casos conhecidos.
--
-- Não substitui o teste unitário de `domain/vehicleCategory.ts`: aquele prova que a função
-- está certa, este prova que a semente que foi para o banco produz o resultado certo. São
-- coisas diferentes, e já erramos uma delas achando que a outra cobria.
--
-- A regra é reproduzida em SQL: casamento por prefixo (`LIKE padrao || '%'`), padrão vazio
-- cobrindo a marca inteira, desempate por `priority` e depois por padrão mais longo. É a
-- mesma ordenação de `escolherCategoria`. Os modelos aqui estão em maiúsculas e sem
-- pontuação porque é assim que `normalizarTexto` entrega o texto antes da comparação.
--
-- Falha com erro quando algum caso sai diferente do esperado: ensaio que informa e segue em
-- frente não serve de barreira.

CREATE TEMP TABLE casos (marca text, modelo text, esperado text, nota text);

INSERT INTO casos VALUES
  -- O desempate por padrão mais longo: "GOLF" também casa com o prefixo "GOL".
  ('VOLKSWAGEN',    'GOL 1 0',             'Economy', 'prefixo curto nao pode levar o GOLF'),
  ('VOLKSWAGEN',    'GOLF 1 4 TSI',        'Comfort', 'padrao mais longo ganha'),
  ('VOLKSWAGEN',    'VIRTUS HIGHLINE',     'Comfort', NULL),
  ('VOLKSWAGEN',    'POLO TRACK',          'Economy', NULL),
  -- O desempate por prioridade: "C3" casa com "C3 AIRCROSS" por prefixo.
  ('CITROEN',       'C3 LIVE 1 0',         'Economy', NULL),
  ('CITROEN',       'C3 AIRCROSS FEEL',    'Comfort', 'prioridade 50 ganha da regra do C3'),
  ('CHEVROLET',     'ONIX PLUS LT',        'Economy', NULL),
  ('CHEVROLET',     'TRACKER PREMIER',     'Comfort', NULL),
  ('TOYOTA',        'COROLLA XEI 2 0',     'Comfort', NULL),
  ('TOYOTA',        'COROLLA CROSS XRE',   'Comfort', NULL),
  ('TOYOTA',        'ETIOS X 1 3',         'Economy', NULL),
  ('HYUNDAI',       'HB20 SENSE 1 0',      'Economy', NULL),
  ('HYUNDAI',       'HB20S VISION',        'Economy', 'seda do mesmo porte do hatch'),
  ('HYUNDAI',       'CRETA ACTION',        'Comfort', NULL),
  ('FIAT',          'MOBI LIKE',           'Economy', NULL),
  ('FIAT',          'GRAND SIENA ATTRACT', 'Economy', 'nao casa com o prefixo SIENA'),
  ('FIAT',          'TORO FREEDOM',        'Comfort', NULL),
  ('RENAULT',       'KWID ZEN',            'Economy', NULL),
  ('RENAULT',       'DUSTER ICONIC',       'Comfort', NULL),
  ('RENAULT',       'LOGAN STEPWAY',       'Economy', NULL),
  ('HONDA',         'HR V EXL',            'Comfort', 'HR-V normalizado vira HR V'),
  ('HONDA',         'FIT LX',              'Economy', NULL),
  ('NISSAN',        'KICKS SV',            'Comfort', NULL),
  ('NISSAN',        'VERSA SV',            'Economy', NULL),
  ('PEUGEOT',       '208 ALLURE',          'Economy', NULL),
  ('PEUGEOT',       '2008 GRIFFE',         'Comfort', 'nao casa com o prefixo 208'),
  -- Marca inteira, `model_pattern` vazio.
  ('MERCEDES BENZ', 'C180 CGI',            'Comfort', 'regra de marca inteira'),
  ('BMW',           '320I',                'Comfort', 'regra de marca inteira'),
  ('JEEP',          'COMPASS LONGITUDE',   'Comfort', NULL),
  ('MITSUBISHI',    'L200 TRITON',         'Comfort', NULL);

-- Casos que **devem** ficar sem regra. É o comportamento certo: sem regra, a declaração do
-- motorista permanece. Uma semente que respondesse algo aqui estaria chutando.
CREATE TEMP TABLE sem_regra (marca text, modelo text);
INSERT INTO sem_regra VALUES
  ('FIAT',       'MAREA TURBO'),
  ('CHEVROLET',  'OMEGA CD'),
  ('MARCA QUE NAO EXISTE', 'MODELO QUALQUER');

CREATE TEMP VIEW decidido AS
SELECT c.marca, c.modelo, c.esperado, c.nota,
       (SELECT r.category::text
          FROM opendriver.vehicle_model_categories r
         WHERE r.active
           AND r.brand = c.marca
           AND (r.model_pattern = '' OR c.modelo LIKE r.model_pattern || '%')
         ORDER BY r.priority ASC, length(r.model_pattern) DESC
         LIMIT 1) AS obtido
  FROM casos c;

\echo '--- casos esperados ---'
SELECT CASE WHEN obtido IS NULL THEN 'SEM REGRA' WHEN obtido = esperado THEN 'ok' ELSE 'ERRADO' END AS r,
       marca, modelo, esperado, coalesce(obtido, '-') AS obtido, coalesce(nota, '') AS nota
  FROM decidido
 ORDER BY (CASE WHEN obtido IS NULL OR obtido <> esperado THEN 0 ELSE 1 END), marca, modelo;

\echo '--- casos que devem ficar SEM regra ---'
SELECT s.marca, s.modelo,
       coalesce((SELECT r.category::text
                   FROM opendriver.vehicle_model_categories r
                  WHERE r.active AND r.brand = s.marca
                    AND (r.model_pattern = '' OR s.modelo LIKE r.model_pattern || '%')
                  ORDER BY r.priority ASC, length(r.model_pattern) DESC
                  LIMIT 1), '(sem regra, correto)') AS obtido
  FROM sem_regra s
 ORDER BY 1, 2;

\echo '--- veredito ---'
DO $$
DECLARE
  errados int;
  indevidos int;
BEGIN
  SELECT count(*) INTO errados
    FROM decidido WHERE obtido IS NULL OR obtido <> esperado;

  SELECT count(*) INTO indevidos
    FROM sem_regra s
   WHERE EXISTS (SELECT 1 FROM opendriver.vehicle_model_categories r
                  WHERE r.active AND r.brand = s.marca
                    AND (r.model_pattern = '' OR s.modelo LIKE r.model_pattern || '%'));

  IF errados > 0 OR indevidos > 0 THEN
    RAISE EXCEPTION 'classificacao reprovada: % caso(s) fora do esperado, % caso(s) classificado(s) indevidamente', errados, indevidos;
  END IF;
  RAISE NOTICE 'classificacao aprovada: % casos conferidos, % confirmados sem regra', (SELECT count(*) FROM casos), (SELECT count(*) FROM sem_regra);
END $$;
