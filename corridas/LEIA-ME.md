# Corridas — app cliente x motorista

App web (PWA, instala no celular) no modelo 99/Uber:

- **Cliente** marca embarque e destino, vê o preço e pede a corrida.
- **Motorista** aprovado fica online, recebe as corridas próximas e aceita.
- **Depois do aceite, os dois veem a localização um do outro no mapa, ao vivo**, até a corrida terminar. Antes do aceite e depois do fim, ninguém vê a posição de ninguém.
- **Admin** aprova ou bloqueia motoristas.

| Arquivo | O que é |
|---|---|
| `index.html` | O app inteiro (cliente, motorista e admin) |
| `supabase/schema.sql` | Banco de dados, regras de segurança e funções |
| `manifest.json`, `sw.js`, `icons/` | Arquivos para instalar como app no celular |

---

## O que você precisa fazer (passo a passo)

### 1. Criar o banco no Supabase (10 min)

1. Entre em <https://supabase.com> e crie um **projeto novo** (região *South America (São Paulo)*).
   Não use o projeto do FrotaManager: alguns nomes de tabela podem colidir.
2. No menu do projeto, abra **SQL Editor** → **New query**.
3. Copie **todo** o conteúdo de `supabase/schema.sql`, cole e clique em **Run**.
   Deve terminar com "Success". Rode **uma vez só**; se precisar refazer, crie outro projeto.

### 2. Configurar o login

Em **Authentication → Sign In / Providers → Email**:

- **Para testar:** desligue **Confirm email**. Assim a conta já entra direto, sem esperar e-mail
  (o envio de e-mail gratuito do Supabase é limitado a poucos por hora).
- **Para lançar:** ligue de novo e configure um SMTP próprio em **Authentication → Emails → SMTP**.

Em **Authentication → URL Configuration**, coloque o endereço onde o app vai ficar (passo 4) em
**Site URL** e em **Redirect URLs**. Isso faz os links de confirmação e de "esqueci a senha" voltarem para o app.

### 3. Ligar o app ao banco

1. No Supabase, abra **Project Settings → API Keys** e copie a chave **anon** (ou *publishable*).
   Em **Project Settings → Data API** copie a **Project URL**.
2. Abra `index.html`, procure `const CONFIG` (logo no começo do `<script>`) e preencha:

```js
const CONFIG = {
  SUPABASE_URL: 'https://xxxxxxxx.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOi...',
  APP_NOME: 'Corridas',   // troque pelo nome do seu app
};
```

A chave *anon* pode ficar no código: ela é pública por natureza. Quem protege os dados são as regras do `schema.sql`.
**Nunca** coloque a chave `service_role` / *secret* no app.

### 4. Publicar com HTTPS

O GPS do celular só funciona em sites **https**. Opções gratuitas:

- **Netlify:** em <https://app.netlify.com/drop>, arraste a pasta `corridas`. Pronto, ele dá um link https.
- **Vercel:** importe o repositório e defina *Root Directory* = `corridas`.
- **GitHub Pages:** publique a pasta `corridas`.

No computador, para testes rápidos, `http://localhost` também libera o GPS:

```bash
cd corridas && python3 -m http.server 8080
```

### 5. Criar o administrador

1. Abra o app e crie uma conta normal (como cliente) com o seu e-mail.
2. No **SQL Editor** do Supabase rode, trocando o e-mail:

```sql
update public.perfis set papel = 'admin'
 where id = (select id from auth.users where email = 'seu-email@exemplo.com');
```

3. Saia e entre de novo no app: aparece a lista de motoristas para aprovar.

### 6. Testar com dois celulares

1. **Celular A:** crie conta como **Motorista** (CNH, carro, placa). Fica "Cadastro em análise".
2. **Admin:** aprove o motorista.
3. **Celular A:** toque em "Verificar novamente" e depois em **ficar online**. Permita a localização.
4. **Celular B:** crie conta como **Cliente**, escolha o destino (busca ou toque no mapa) e toque em **Pedir corrida**.
5. **Celular A:** a corrida aparece com som e vibração → **Aceitar**.
6. Agora **os dois veem um ao outro no mapa**, com a distância atualizando sozinha.
7. Motorista: **Cheguei ao local** → **Iniciar corrida** → **Finalizar**. Os dois avaliam.

> A corrida só aparece para motoristas online num raio de 5 km do embarque (ajustável, passo 7).

### 7. Ajustar preço e regras

No Supabase, **Table Editor → tarifa** (uma linha só):

| Coluna | Padrão | Significado |
|---|---|---|
| `bandeirada` | 5,00 | valor fixo de partida |
| `por_km` | 2,50 | valor por km |
| `minimo` | 10,00 | preço mínimo da corrida |
| `fator_rota` | 1,30 | corrige a distância em linha reta para a distância pelas ruas |
| `raio_busca_km` | 5 | até que distância o motorista recebe pedidos |
| `expira_min` | 10 | minutos até cancelar um pedido que ninguém aceitou |

O preço é sempre calculado **no servidor**: o cliente não consegue mudar o valor pelo navegador.

---

## Como funciona a segurança

- O navegador **não grava nada direto** nas tabelas. Tudo passa por funções no banco que conferem quem está chamando
  (só cliente pede corrida, só o motorista dono da corrida avança o status, só admin aprova motorista).
- **Aceite único:** se dois motoristas tocarem em "Aceitar" ao mesmo tempo, só um fica com a corrida.
- **Localização:** a posição "online" do motorista nunca é mostrada a clientes; só é usada para achar corridas próximas.
  A posição compartilhada só é visível para as duas pessoas da corrida, enquanto ela está ativa, e é apagada ao finalizar ou cancelar.
- **CNH** só o admin vê. Telefone e nome só a outra parte da corrida vê.
- Cada pessoa só pode ter **uma corrida ativa** por vez.
- Se o **motorista desiste**, a corrida volta para outros motoristas; se o **cliente cancela**, ela é encerrada.

---

## Limitações desta primeira versão (e como resolver)

| Limitação | Por quê | Solução |
|---|---|---|
| O motorista precisa manter o app **aberto e a tela ligada** | Navegadores pausam o GPS quando a tela apaga. O app já pede para a tela não apagar. | Empacotar como app Android/iOS (ex.: Capacitor) com localização em segundo plano. |
| Sem notificação com o app fechado | Hoje o aviso é som + vibração com o app aberto. | Web Push (Firebase Cloud Messaging) ou app nativo. |
| Pagamento fora do app | Cliente paga em dinheiro/Pix direto ao motorista. | Integrar Pix/cartão (Mercado Pago, Asaas, Pagar.me) e repasse ao motorista. |
| Mapa, busca de endereço e rota usam serviços **gratuitos do OpenStreetMap** | São servidores públicos de demonstração, com limite de uso. A busca de endereço aceita 1 pedido por segundo. | Para lançar, contratar um provedor (MapTiler, Mapbox ou Google Maps) e trocar os 3 endereços em `SERVICOS` no `index.html`. |
| Preço por distância em linha reta × 1,3 | Não depende de serviço pago. | Calcular pela rota real numa Edge Function do Supabase. |

---

## Antes de abrir para o público (não é código, mas é obrigatório)

Transporte remunerado por aplicativo é regulado pela **Lei 13.640/2018** e por **leis de cada município**.
Converse com um advogado sobre:

- [ ] Exigências da prefeitura da cidade onde vai operar (cadastro da empresa e dos motoristas, taxas).
- [ ] Motoristas: CNH com observação **EAR**, certidão de antecedentes criminais, documento do veículo, INSS como contribuinte individual.
- [ ] Seguro de **Acidentes Pessoais a Passageiros (APP)**, exigido pela lei, e o seguro obrigatório de veículos que estiver em vigor (confirme com o advogado, essa regra mudou nos últimos anos).
- [ ] **LGPD:** o app trata localização, telefone e CNH. Precisa de política de privacidade, termos de uso e
      um jeito de o usuário pedir a exclusão dos dados.
- [ ] Modelo de cobrança (comissão por corrida, mensalidade do motorista) e emissão de nota fiscal.

---

## Próximos passos sugeridos

1. Testar em dois celulares de verdade (passo 6) na sua cidade.
2. Trocar o mapa por um provedor pago e calcular o preço pela rota real.
3. Pagamento por Pix dentro do app.
4. App nativo para o motorista (GPS em segundo plano e notificações).
5. Painel do admin com corridas ao vivo, ganhos por motorista e suporte.
