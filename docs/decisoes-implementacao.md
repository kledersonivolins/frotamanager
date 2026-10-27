# Decisões e atualizações do FrotaManager

Data: 2026-09-06
Tenant ativo: `oficinafni`

## Empréstimos de veículos

- A solicitação passa por aprovação.
- O solicitante não pode editar a própria solicitação depois do envio.
- O checklist não é obrigatório para liberar saída ou devolução.
- A exclusão é lógica: empréstimos usam `status=cancelado` e `ativo=false`.
- Os 36 registros históricos foram migrados de `construtorabs` para `oficinafni`, preservando os IDs.

## Migração de tenant

- Empresas: 3 registros em `oficinafni`.
- Centros de custo: 3 registros em `oficinafni`.
- Equipamentos/veículos: 224 registros em `oficinafni`.
- Rastreio de veículos: 23 registros migrados para `oficinafni`.
- Também foram migrados os registros antigos de solicitações, rastreio histórico, Wialon, WhatsApp, tokens e layouts.
- A licença antiga de `construtorabs` foi mantida separada porque a tabela permite somente uma licença por tenant e já existe uma licença ativa em `oficinafni`; nenhum cadastro operacional depende dela.
- O código do índice não faz mais leitura nem gravação no tenant antigo.

## Agendamento externo de manutenção

- O formulário não exige login.
- Empresa e placa são carregadas do Supabase.
- A disponibilidade valida agendamentos conflitantes, veículo indisponível e OS aberta.
- O envio gera protocolo e comprovante.
- O pedido fica pendente até aprovação interna.
- A aprovação gera uma Pré-OS.

## Portaria e publicação

- O módulo Portaria foi reexibido no menu.
- A versão corrigida do índice está neste repositório.
- Alterações de schema/RLS precisam ser aplicadas no SQL Editor do Supabase quando indicado pelos arquivos SQL de suporte.

## Troca de óleo e filtros (2026-10-27)

- Arquivos: `troca-oleo.js` (módulo), `sql/troca_oleo.sql` (tabelas), tag `<script src="troca-oleo.js">` no final do `index.html`.
- Na OS, o tipo de manutenção "🛢️ Troca de Óleo" exibe o painel de óleos/filtros com referência, quantidade e unidade. Referências ficam gravadas por veículo (`troca_oleo_veiculo`) e voltam preenchidas na próxima OS.
- Itens marcados como "Trocar" entram nos itens da OS e atualizam data e hodômetro da última troca do veículo.
- Módulo "Troca de Óleo" (menu Manutenção): itens e intervalos (km/horas e dias, quantidade padrão) em `troca_oleo_config`; painel de vencimentos (Vencido / Próximo / Em dia); referências por veículo.
- O módulo se liga às funções do sistema em tempo de execução (`openModalOS`, `salvarOS`, `PAGE_FNS`, `MENU`, `SB_TABLES`). O `index.html` deste repositório está incompleto (sem `loadPage`, `openModal`, `openModalOS`, `salvarOS`), então a integração só foi testada com um harness simulado.
- Usuários com `modulos_liberados` preenchido precisam receber o módulo `troca_oleo`.
