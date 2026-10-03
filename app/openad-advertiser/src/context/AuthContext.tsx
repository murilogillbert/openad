import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { AppState } from 'react-native';
import {
  encerrarSessao,
  hub,
  iniciarSessao,
  registrarAvisosDeSessao,
  tokenStorage,
} from '@/api/client';
import { adesao as apiAdesao, conta as apiConta } from '@/api/endpoints';
import { ApiError } from '@/api/errors';
import type { RespostaDeAutenticacao, SituacaoDeAdesao, UsuarioDoEcossistema } from '@/api/types';

/**
 * Quatro estados, e o terceiro é a razão deste contexto existir.
 *
 * `carregando`   — restaurando a sessão do Keychain/Keystore
 * `deslogado`    — sem conta
 * `precisaAderir`— **tem** conta do ecossistema, mas ainda não é anunciante no openad
 * `pronto`       — é anunciante ativo
 *
 * Sem o terceiro estado, a navegação não teria como distinguir "não entrou" de "entrou mas
 * ainda não aderiu" — e as duas situações levam a telas diferentes. A diferença é observável:
 * com conta e sem adesão, `/advertiser/campaigns` responde **401**, porque
 * `FederatedJwtStrategy` resolve o anunciante em `openad.ad_advertisers` e devolve `null` sem
 * a linha. Tratar esse 401 como "sessão expirou" jogaria o anunciante de volta para o login
 * num laço, com a senha certa.
 */
export type EstadoDaSessao = 'carregando' | 'deslogado' | 'precisaAderir' | 'pronto';

interface ValorDeAutenticacao {
  estado: EstadoDaSessao;
  usuario: UsuarioDoEcossistema | null;
  anunciante: SituacaoDeAdesao['anunciante'];
  entrar(email: string, senha: string): Promise<void>;
  cadastrar(dados: {
    name: string;
    email: string;
    password: string;
    phone?: string;
  }): Promise<void>;
  sair(): Promise<void>;
  /** Torna a conta um anunciante ativo. Idempotente no servidor. */
  aderir(legalName?: string): Promise<void>;
  /** Reconsulta conta e adesão (depois de aderir, ou ao voltar do segundo plano). */
  recarregar(): Promise<void>;
}

const Contexto = createContext<ValorDeAutenticacao | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [estado, setEstado] = useState<EstadoDaSessao>('carregando');
  const [usuario, setUsuario] = useState<UsuarioDoEcossistema | null>(null);
  const [anunciante, setAnunciante] = useState<SituacaoDeAdesao['anunciante']>(null);

  /**
   * Resolve o estado consultando a adesão no openad.
   *
   * `GET /advertiser/onboarding` devolve conta **e** situação de adesão numa chamada só, de
   * propósito: duas chamadas (uma para `/auth/me` no hub, outra para a adesão) deixariam a
   * tela num estado intermediário visível se a segunda falhasse.
   */
  const resolver = useCallback(async () => {
    const situacao = await apiAdesao.situacao();
    setAnunciante(situacao.anunciante);
    setEstado(situacao.precisaAderir ? 'precisaAderir' : 'pronto');
    // O nome e o e-mail vêm da própria resposta: evita uma ida ao hub só para isso.
    setUsuario((atual) =>
      atual ?? {
        id: situacao.conta.userId,
        name: situacao.conta.name,
        email: situacao.conta.email,
        role: '',
      }
    );
  }, []);

  const limparLocal = useCallback(async () => {
    await encerrarSessao();
    queryClient.clear();
    setUsuario(null);
    setAnunciante(null);
    setEstado('deslogado');
  }, [queryClient]);

  // Restaura a sessão guardada no armazenamento seguro.
  useEffect(() => {
    let cancelado = false;
    (async () => {
      await tokenStorage.init();
      if (!(await hub.hasSession())) {
        if (!cancelado) setEstado('deslogado');
        return;
      }
      try {
        await resolver();
      } catch (err) {
        if (cancelado) return;
        if (err instanceof ApiError && err.isUnauthorized) {
          // O cliente HTTP já tentou renovar e falhou; a sessão morreu de verdade.
          setEstado('deslogado');
          return;
        }
        /**
         * Sem internet na abertura: **mantém** a sessão e assume `precisaAderir` não
         * resolvido como `pronto`, para que as telas carreguem e mostrem o próprio erro com
         * "tentar de novo". Deslogar por falta de sinal obrigaria a digitar a senha de novo
         * no metrô — e a sessão estava válida.
         */
        setEstado('pronto');
        setTimeout(() => {
          if (!cancelado) resolver().catch(() => undefined);
        }, 3000);
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [resolver]);

  // Expiração vinda de qualquer um dos dois clientes HTTP.
  useEffect(() => {
    registrarAvisosDeSessao({
      aoExpirar: () => {
        queryClient.clear();
        setUsuario(null);
        setAnunciante(null);
        setEstado('deslogado');
      },
      aoRenovar: (u) => setUsuario(u),
    });
  }, [queryClient]);

  // Volta do segundo plano: reconsulta a adesão, no máximo a cada 30 s. Pega o caso de o
  // anunciante ter sido suspenso enquanto o app estava fechado.
  useEffect(() => {
    if (estado !== 'pronto' && estado !== 'precisaAderir') return;
    let ultima = Date.now();
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active' || Date.now() - ultima < 30_000) return;
      ultima = Date.now();
      resolver().catch(() => undefined);
    });
    return () => sub.remove();
  }, [estado, resolver]);

  const comecar = useCallback(
    async (res: RespostaDeAutenticacao) => {
      await iniciarSessao({ token: res.token, refreshToken: res.refreshToken });
      queryClient.clear();
      setUsuario(res.user);
      await resolver();
    },
    [queryClient, resolver]
  );

  const entrar = useCallback(
    async (email: string, senha: string) => comecar(await apiConta.entrar(email, senha)),
    [comecar]
  );

  const cadastrar = useCallback(
    async (dados: { name: string; email: string; password: string; phone?: string }) =>
      comecar(await apiConta.cadastrar(dados)),
    [comecar]
  );

  const aderir = useCallback(
    async (legalName?: string) => {
      const r = await apiAdesao.aderir(legalName);
      setAnunciante(r.anunciante);
      setEstado('pronto');
      // A lista de campanhas respondia 401 antes da adesão: o cache precisa cair para ela
      // refazer a consulta agora que a resposta muda.
      queryClient.clear();
    },
    [queryClient]
  );

  const valor = useMemo<ValorDeAutenticacao>(
    () => ({
      estado,
      usuario,
      anunciante,
      entrar,
      cadastrar,
      sair: limparLocal,
      aderir,
      recarregar: resolver,
    }),
    [estado, usuario, anunciante, entrar, cadastrar, limparLocal, aderir, resolver]
  );

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useAuth(): ValorDeAutenticacao {
  const ctx = useContext(Contexto);
  if (!ctx) throw new Error('useAuth fora do AuthProvider');
  return ctx;
}
