import { Redirect } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import { LoadingState } from '@/components/ui/States';
import { Screen } from '@/components/ui/Screen';

/**
 * Porta de entrada: manda para a tela certa conforme o estado da sessão.
 *
 * O redirecionamento mora aqui, numa rota, e não num `useEffect` do layout. Navegar de dentro
 * de efeito no layout corre antes de o roteador estar pronto e produz o aviso de "navigate
 * before mounting" com a navegação silenciosamente perdida.
 */
export default function Entrada() {
  const { estado } = useAuth();

  if (estado === 'carregando') {
    return (
      <Screen scroll={false} edges={['top', 'bottom']}>
        <LoadingState label="Abrindo…" />
      </Screen>
    );
  }
  if (estado === 'deslogado') return <Redirect href="/login" />;
  if (estado === 'precisaAderir') return <Redirect href="/adesao" />;
  return <Redirect href="/campanhas" />;
}
