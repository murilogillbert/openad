import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Screen } from '@/components/ui/Screen';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { AppText, Card, Stack } from '@/components/ui/primitives';
import { errorMessage } from '@/api/errors';
import { useAuth } from '@/context/AuthContext';
import { colors } from '@/theme/tokens';

export default function Cadastro() {
  const { cadastrar } = useAuth();
  const router = useRouter();
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [telefone, setTelefone] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const emailValido = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
  const podeEnviar = nome.trim().length >= 3 && emailValido && senha.length >= 8 && !enviando;

  async function enviar() {
    if (!podeEnviar) return;
    setErro(null);
    setEnviando(true);
    try {
      await cadastrar({
        name: nome.trim(),
        email: email.trim().toLowerCase(),
        password: senha,
        ...(telefone.trim() ? { phone: telefone.trim() } : {}),
      });
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
        <AppText variant="title">Criar conta</AppText>
        <AppText variant="small">
          A conta é a mesma dos três serviços do ecossistema: OpenDriver, OpenDriverHub e
          anúncios.
        </AppText>

        <Card>
          <Stack gap={12}>
            <TextField
              label="Nome"
              value={nome}
              onChangeText={setNome}
              autoComplete="name"
              textContentType="name"
            />
            <TextField
              label="E-mail"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              textContentType="emailAddress"
              error={email.length > 0 && !emailValido ? 'E-mail inválido' : undefined}
            />
            <TextField
              label="Telefone (opcional)"
              value={telefone}
              onChangeText={setTelefone}
              keyboardType="phone-pad"
              autoComplete="tel"
            />
            <TextField
              label="Senha"
              value={senha}
              onChangeText={setSenha}
              password
              autoComplete="new-password"
              textContentType="newPassword"
              hint="Pelo menos 8 caracteres"
              error={senha.length > 0 && senha.length < 8 ? 'Senha muito curta' : undefined}
            />
            {erro ? (
              <AppText variant="small" color={colors.danger} accessibilityLiveRegion="polite">
                {erro}
              </AppText>
            ) : null}
            <Button
              title="Criar conta"
              onPress={enviar}
              loading={enviando}
              disabled={!podeEnviar}
              size="lg"
            />
          </Stack>
        </Card>
      </Stack>
    </Screen>
  );
}
