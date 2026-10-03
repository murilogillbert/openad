import { Link, Stack } from 'expo-router';
import { Screen } from '@/components/ui/Screen';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/States';

export default function NaoEncontrado() {
  return (
    <Screen scroll={false} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Não encontrado' }} />
      <EmptyState
        icon="help-circle-outline"
        title="Esta tela não existe"
        message="O link pode estar desatualizado."
        action={
          <Link href="/" asChild>
            <Button title="Voltar ao início" icon="home-outline" />
          </Link>
        }
      />
    </Screen>
  );
}
