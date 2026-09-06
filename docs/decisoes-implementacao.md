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
