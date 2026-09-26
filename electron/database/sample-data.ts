import type { CreateCategoryData, CreateTemplateData, CreatePromptData } from '../../src/types'

export const sampleCategories: CreateCategoryData[] = [
  { name: 'Geral', description: 'Prompts de uso geral para diversas tarefas', color: '#6366f1' },
  { name: 'Escrita criativa', description: 'Prompts para escrita criativa, narrativas e criação de conteúdo', color: '#ec4899' },
  { name: 'Geração de código', description: 'Prompts de programação, depuração e código em geral', color: '#10b981' },
  { name: 'Análise', description: 'Prompts de análise de dados, pesquisa e pensamento analítico', color: '#f59e0b' },
  { name: 'Negócios', description: 'Estratégia de negócios, marketing e comunicação profissional', color: '#8b5cf6' },
  { name: 'Educação', description: 'Prompts de aprendizado, ensino e conteúdo educacional', color: '#06b6d4' },
  { name: 'Pessoal', description: 'Prompts de desenvolvimento pessoal, produtividade e estilo de vida', color: '#ef4444' },
]

export const sampleTemplates: CreateTemplateData[] = [
  {
    name: 'Template de revisão de código',
    description: 'Revisão de código completa, com áreas de foco definidas',
    content: `Revise o código em {{linguagem}} abaixo e dê seu feedback:

\`\`\`{{linguagem}}
{{codigo}}
\`\`\`

Concentre-se em:
- Qualidade e legibilidade do código
- Otimizações de desempenho
- Questões de segurança
- Boas práticas de {{linguagem}}
- Possíveis bugs ou problemas

Traga sugestões específicas de melhoria.`,
    variables: ['linguagem', 'codigo'],
    category_id: 3
  },
  {
    name: 'Esboço de post para blog',
    description: 'Estrutura para criar posts de blog envolventes',
    content: `Crie um esboço detalhado de post para blog sobre: "{{titulo}}"

Público-alvo: {{publico_alvo}}
Tom: {{tom}}
Extensão: {{num_palavras}} palavras

Inclua:
1. Variações de título chamativas (3 a 5 opções)
2. Gancho para a introdução
3. Seções principais com subtítulos
4. Pontos-chave de cada seção
5. Ideias de chamada para ação (CTA)
6. Considerações de SEO

Faça com que o conteúdo seja envolvente e prático para {{publico_alvo}}.`,
    variables: ['titulo', 'publico_alvo', 'tom', 'num_palavras'],
    category_id: 2
  },
  {
    name: 'Framework de análise de dados',
    description: 'Abordagem estruturada para tarefas de análise de dados',
    content: `Analise os seguintes dados de {{tipo_dados}}:

{{descricao_dados}}

Forneça:
1. Visão geral dos dados e avaliação da qualidade
2. Principais padrões e tendências identificados
3. Insights estatísticos e correlações
4. Análise {{tipo_analise}}
5. Recomendações práticas
6. Possíveis limitações e ressalvas

Apresente os resultados em um formato claro e acessível para a área de negócios, com sugestões de visualizações que os sustentem.`,
    variables: ['tipo_dados', 'descricao_dados', 'tipo_analise'],
    category_id: 4
  },
  {
    name: 'Criador de plano de estudos',
    description: 'Template de roteiro de aprendizado personalizado',
    content: `Crie um plano de estudos completo sobre: {{assunto}}

Perfil do estudante:
- Nível atual: {{nivel_atual}}
- Tempo disponível: {{tempo_disponivel}} por semana
- Estilo de aprendizagem: {{estilo_aprendizagem}}
- Objetivo: {{objetivo}}

Inclua:
1. Objetivos de aprendizagem e marcos
2. Plano de estudos semana a semana
3. Recursos recomendados (livros, cursos, tutoriais)
4. Exercícios práticos e projetos
5. Formas de avaliação
6. Como superar os desafios mais comuns

Faça um plano prático e viável dentro do prazo especificado.`,
    variables: ['assunto', 'nivel_atual', 'tempo_disponivel', 'estilo_aprendizagem', 'objetivo'],
    category_id: 6
  },
  {
    name: 'Template de resumo de reunião',
    description: 'Anotações de reunião e itens de ação em formato profissional',
    content: `Resuma o conteúdo da reunião a seguir:

Reunião: {{titulo_reuniao}}
Data: {{data}}
Participantes: {{participantes}}

Anotações da reunião:
{{anotacoes_reuniao}}

Forneça:
1. Resumo executivo (2 a 3 frases)
2. Principais decisões tomadas
3. Itens de ação com responsáveis e prazos
4. Questões em aberto e próximos passos
5. Reuniões de acompanhamento necessárias

Formate o resumo para facilitar o compartilhamento com as partes interessadas.`,
    variables: ['titulo_reuniao', 'data', 'participantes', 'anotacoes_reuniao'],
    category_id: 5
  }
]

export const samplePrompts: CreatePromptData[] = [
  // Creative Writing Prompts
  {
    title: 'Assistente de criação de personagens',
    content: `Me ajude a criar um personagem marcante para a minha história. Faça perguntas sobre o passado, as motivações, os medos e os objetivos dele. Depois, monte um perfil detalhado do personagem, incluindo:

- Descrição física
- Traços de personalidade e manias
- História pregressa e experiências que o marcaram
- Conflitos internos e arco de evolução
- Relações com os outros personagens
- Estilo de diálogo e maneira de falar

Faça com que o personagem pareça autêntico e tridimensional.`,
    description: 'Criação interativa de personagens para ficção',
    category_id: 2,
    tags: ['escrita', 'personagens', 'ficção', 'criatividade'],
    is_favorite: true
  },
  {
    title: 'Gerador de reviravoltas',
    content: `Estou escrevendo uma história de {{genero}} e preciso de ajuda para criar uma reviravolta inesperada na trama. Este é o enredo atual:

{{resumo_enredo}}

A reviravolta deve:
- Surpreender, mas fazer sentido olhando para trás
- Ter ligação com elementos que já apareceram na história
- Aumentar o que está em jogo para o protagonista
- Soar natural dentro do universo da história

Sugira 3 opções diferentes de reviravolta, com uma breve explicação de como deixar pistas de cada uma nas partes anteriores da história.`,
    description: 'Gere reviravoltas surpreendentes para suas histórias',
    category_id: 2,
    template_id: null,
    tags: ['escrita', 'enredo', 'narrativa', 'criatividade', 'ficção'],
    is_favorite: false
  },

  // Code Generation Prompts
  {
    title: 'Criador de endpoints de API',
    content: `Crie um endpoint de API RESTful para {{recurso}} com os seguintes requisitos:

Framework: {{framework}}
Banco de dados: {{banco_de_dados}}
Autenticação: {{tipo_autenticacao}}

Inclua:
- Definição das rotas com os métodos HTTP adequados
- Schemas de requisição e resposta
- Validação de entrada
- Tratamento de erros
- Consultas ao banco de dados
- Middleware de autenticação
- Testes unitários
- Documentação da API

Siga as boas práticas de segurança, desempenho e manutenibilidade.`,
    description: 'Gere endpoints de API completos, com testes e documentação',
    category_id: 3,
    tags: ['api', 'backend', 'rest', 'banco-de-dados', 'autenticação'],
    is_favorite: true
  },
  {
    title: 'Otimização de algoritmos',
    content: `Analise e otimize este algoritmo para melhorar o desempenho:

\`\`\`python
{{algoritmo}}
\`\`\`

Complexidade de tempo atual: {{complexidade_atual}}
Melhoria desejada: {{melhoria_desejada}}

Forneça:
1. Análise de complexidade da implementação atual
2. Gargalos e problemas de desempenho identificados
3. Versão otimizada, com explicações
4. Nova análise de complexidade de tempo e espaço
5. Sugestões de benchmark
6. Abordagens alternativas, se houver

Inclua exemplos de código e explique as técnicas de otimização utilizadas.`,
    description: 'Analise e melhore o desempenho de algoritmos',
    category_id: 3,
    tags: ['algoritmos', 'otimização', 'desempenho', 'python', 'complexidade'],
    is_favorite: false
  },

  // Analysis Prompts
  {
    title: 'Analisador de pesquisa de mercado',
    content: `Faça uma análise de mercado completa do setor de {{setor}}, com foco em {{mercado_alvo}}.

Áreas de pesquisa:
- Tamanho do mercado e tendências de crescimento
- Principais concorrentes e seu posicionamento
- Segmentos de clientes e personas
- Estratégias e modelos de precificação
- Oportunidades e ameaças emergentes
- Disrupções tecnológicas
- Aspectos regulatórios

Traga insights práticos e recomendações estratégicas para entrar nesse mercado ou expandir a atuação nele.`,
    description: 'Pesquisa de mercado completa e análise da concorrência',
    category_id: 4,
    tags: ['pesquisa-de-mercado', 'análise', 'negócios', 'estratégia', 'concorrência'],
    is_favorite: true
  },
  {
    title: 'Consultor de visualização de dados',
    content: `Tenho um conjunto de dados com as seguintes características:
- Tipo de dados: {{tipo_dados}}
- Tamanho: {{tamanho_dados}}
- Variáveis principais: {{variaveis}}
- Pergunta de negócio: {{pergunta_negocio}}

Recomende os melhores tipos de visualização e elabore:
1. Tipos de gráfico adequados para cada variável
2. Sugestões de layout para o dashboard
3. Paletas de cores e diretrizes de estilo
4. Recursos interativos a incluir
5. Principais insights a destacar
6. Recomendações de ferramentas e bibliotecas

Priorize clareza, precisão e impacto nos negócios.`,
    description: 'Orientação especializada em visualização de dados e design de dashboards',
    category_id: 4,
    tags: ['visualização-de-dados', 'gráficos', 'dashboard', 'análise-de-dados', 'insights'],
    is_favorite: false
  },

  // Business Prompts
  {
    title: 'Redator de campanhas de e-mail',
    content: `Crie uma campanha de e-mail profissional para {{tipo_campanha}}:

Público-alvo: {{publico_alvo}}
Objetivo: {{objetivo}}
Tom: {{tom}}
Setor: {{setor}}

Inclua:
- Assunto chamativo (5 variações)
- Corpo do e-mail com estrutura clara
- Chamada para ação (CTA) forte
- Sequência de follow-up (3 e-mails)
- Sugestões de teste A/B
- Métricas de desempenho a acompanhar

Garanta que a campanha siga as boas práticas e a regulamentação de e-mail marketing.`,
    description: 'Criação de campanhas profissionais de e-mail marketing',
    category_id: 5,
    tags: ['e-mail', 'marketing', 'copywriting', 'campanhas', 'negócios'],
    is_favorite: true
  },
  {
    title: 'Revisor de plano de negócios',
    content: `Revise meu plano de negócios e dê um feedback detalhado:

{{plano_negocios}}

Avalie:
- Clareza e impacto do resumo executivo
- Profundidade e precisão da análise de mercado
- Realismo das projeções financeiras
- Eficácia da estratégia de marketing
- Viabilidade do plano operacional
- Abrangência da avaliação de riscos
- Justificativa da necessidade de investimento

Dê sugestões específicas de melhoria e destaque os pontos fortes e fracos.`,
    description: 'Análise completa e feedback sobre planos de negócios',
    category_id: 5,
    tags: ['plano-de-negócios', 'estratégia', 'análise', 'feedback', 'empreendedorismo'],
    is_favorite: false
  },

  // Education Prompts
  {
    title: 'Criador de planos de aula',
    content: `Crie um plano de aula envolvente de {{disciplina}} para alunos de {{ano_escolar}}.

Tema: {{tema}}
Duração: {{duracao}}
Objetivos de aprendizagem: {{objetivos}}

Inclua:
- Objetivos de aprendizagem (específicos e mensuráveis)
- Materiais e recursos necessários
- Detalhamento das atividades, passo a passo
- Formas de avaliação
- Estratégias de diferenciação pedagógica
- Atividades de aprofundamento para alunos mais avançados
- Tarefas para casa
- Perguntas para reflexão

Torne a aula interativa e alinhada às diretrizes educacionais.`,
    description: 'Plano de aula completo, com atividades e avaliações',
    category_id: 6,
    tags: ['educação', 'plano-de-aula', 'ensino', 'aprendizado', 'currículo'],
    is_favorite: true
  },
  {
    title: 'Gerador de guias de estudo',
    content: `Crie um guia de estudo completo de {{disciplina}}, com foco em {{topicos}}.

Adapte o formato para o estilo de aprendizagem {{estilo_aprendizagem}}.
Data da prova: {{data_prova}}
Tempo disponível para estudo: {{tempo_estudo}}

Inclua:
- Conceitos-chave e definições
- Resumo dos principais tópicos
- Questões para praticar, com respostas
- Técnicas de memorização e mnemônicos
- Cronograma de estudos detalhado
- Checklists de revisão
- Erros comuns a evitar
- Recursos adicionais

Faça um guia prático e focado na prova.`,
    description: 'Guias de estudo personalizados para a preparação para provas',
    category_id: 6,
    tags: ['guia-de-estudo', 'preparação-para-provas', 'aprendizado', 'educação', 'memorização'],
    is_favorite: false
  },

  // Personal Development Prompts
  {
    title: 'Coach de definição de metas',
    content: `Me ajude a definir e planejar metas práticas para {{periodo}}.

Situação atual: {{situacao_atual}}
Resultados desejados: {{resultados_desejados}}
Restrições: {{restricoes}}

Forneça:
- Formulação das metas no modelo SMART
- Divisão em marcos
- Plano de ação com prazos
- Possíveis obstáculos e soluções
- Métricas de sucesso e formas de acompanhamento
- Estratégias para manter o compromisso
- Técnicas de motivação
- Estrutura para revisão semanal

Faça um plano realista e alcançável.`,
    description: 'Definição de metas pessoais e planejamento para alcançá-las',
    category_id: 7,
    tags: ['metas', 'planejamento', 'produtividade', 'desenvolvimento-pessoal', 'motivação'],
    is_favorite: true
  },
  {
    title: 'Guia de formação de hábitos',
    content: `Me ajude a criar um hábito duradouro de {{descricao_habito}}.

Rotina atual: {{rotina_atual}}
Tempo disponível: {{tempo_disponivel}}
Nível de motivação: {{nivel_motivacao}}
Dificuldades anteriores: {{dificuldades_anteriores}}

Crie um plano que inclua:
- Oportunidades de empilhamento de hábitos (habit stacking)
- Sugestões para ajustar o ambiente
- Sistema de recompensas
- Formas de acompanhar o progresso
- Como superar os obstáculos mais comuns
- Processo de revisão semanal do hábito
- Estratégias de manutenção a longo prazo

Use princípios comprovados da ciência comportamental.`,
    description: 'Estratégias baseadas em ciência para criar e manter hábitos',
    category_id: 7,
    tags: ['hábitos', 'comportamento', 'desenvolvimento-pessoal', 'rotina', 'psicologia'],
    is_favorite: false
  },

  // General Purpose Prompts
  {
    title: 'Framework para tomada de decisão',
    content: `Me ajude a tomar uma decisão bem fundamentada sobre {{decisao}}.

Contexto: {{contexto}}
Opções: {{opcoes}}
Restrições: {{restricoes}}
Prazo: {{prazo}}

Aplique um processo estruturado de tomada de decisão:
1. Esclareça os objetivos e os critérios
2. Avalie os prós e contras de cada opção
3. Avaliação de riscos de cada escolha
4. Análise do impacto nas partes interessadas
5. Análise de custo-benefício
6. Considerações sobre a implementação
7. Plano de contingência
8. Recomendação final, com justificativa

Traga uma perspectiva objetiva e analítica.`,
    description: 'Abordagem estruturada para tomar decisões importantes',
    category_id: 1,
    tags: ['tomada-de-decisão', 'análise', 'estratégia', 'planejamento', 'framework'],
    is_favorite: true
  },
  {
    title: 'Assistente de resolução de problemas',
    content: `Estou enfrentando este problema: {{descricao_problema}}

Contexto e histórico: {{contexto}}
O que já tentei até agora: {{solucoes_tentadas}}
Restrições: {{restricoes}}

Me ajude a resolvê-lo usando:
1. Definição do problema e análise da causa raiz
2. Técnicas de brainstorming criativo
3. Critérios para avaliar as soluções
4. Plano de implementação passo a passo
5. Estratégias de mitigação de riscos
6. Formas de medir o sucesso
7. Abordagens alternativas caso a primeira solução não funcione

Pense de forma sistemática e criativa.`,
    description: 'Resolução sistemática de problemas com metodologias comprovadas',
    category_id: 1,
    tags: ['resolução-de-problemas', 'análise', 'criatividade', 'planejamento', 'metodologia'],
    is_favorite: false
  }
]

// Map category names to IDs for template and prompt assignments
export function assignCategoryIds(categories: any[], templates: CreateTemplateData[], prompts: CreatePromptData[]) {
  const categoryMap = new Map(categories.map((cat, index) => [cat.name, index + 1]))
  
  // Update templates
  templates.forEach(template => {
    if (template.category_id && template.category_id <= categories.length) {
      template.category_id = categoryMap.get(categories[template.category_id - 1].name) || template.category_id
    }
  })
  
  // Update prompts
  prompts.forEach(prompt => {
    if (prompt.category_id && prompt.category_id <= categories.length) {
      prompt.category_id = categoryMap.get(categories[prompt.category_id - 1].name) || prompt.category_id
    }
  })
}