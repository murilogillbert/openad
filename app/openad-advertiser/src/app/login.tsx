import { Link, useRouter } from 'expo-router';
import { useState } from 'react';
import { Screen } from '@/components/ui/Screen';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { AppText, Card, Stack } from '@/components/ui/primitives';
import { errorMessage } from '@/api/errors';
import { useAuth } from '@/context/AuthContext';

export default function Login() {
  const { entrar } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const podeEnviar = email.trim().length > 3 && senha.length >= 6 && !enviando;

  async function enviar() {
    if (!podeEnviar) return;
    setErro(null);
    setEnviando(true);
    try {
      await entrar(email.trim(), senha);
      // `replace` e não `push`: sem isto, o botão voltar do Android levaria de volta ao login
      // já autenticado.
      router.replace('/');
    } catch (err) {
      setErro(errorMessage(err));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Screen>
      <Stack gap={16}>
        <AppText variant="title">Anuncie no OpenDriver</AppText>
        <AppText variant="small">
          Use a mesma conta do OpenDriver e do OpenDriverHub. Se você já tem conta em qualquer um
          dos dois, ela funciona aqui.
        </AppText>

        <Card>
          <Stack gap={12}>
            <TextField
              label="E-mail"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              textContentType="emailAddress"
              placeholder="voce@empresa.com.br"
            />
            <TextField
              label="Senha"
              value={senha}
              onChangeText={setSenha}
              password
              autoComplete="current-password"
              textContentType="password"
              onSubmitEditing={enviar}
              returnKeyType="go"
            />
            {erro ? (
              <AppText variant="small" color="#D6453F" accessibilityLiveRegion="polite">
                {erro}
              </AppText>
            ) : null}
            <Button
              title="Entrar"
              onPress={enviar}
              loading={enviando}
              disabled={!podeEnviar}
              size="lg"
            />
          </Stack>
        </Card>

        <Stack gap={8}>
          <Link href="/cadastro" asChild>
            <Button title="Criar uma conta" variant="outline" />
          </Link>
        </Stack>
      </Stack>
    </Screen>
  );
}
