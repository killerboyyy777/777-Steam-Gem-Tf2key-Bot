name: ❓ Support / Usage Question
about: Ask a question about the bot's usage, configuration, or ask for general support.
labels: ["question"]
assignees: "killerboyyy777"
title: "[QUESTION]: Brief summary of your question"

body:
  - type: markdown
    attributes:
      value: |
        ## Support / Question Request
        Please use this template for questions about usage, setup, or configuration. If the bot is crashing or acting unexpectedly, please use the Bug Report template instead.

  - type: textarea
    id: question-details
    attributes:
      label: 1. What is your question or support issue?
      description: Describe the problem you are facing or the question you have.
    validations:
      required: true

  - type: textarea
    id: config-and-environment
    attributes:
      label: 2. Configuration & Environment Details
      description: This helps us troubleshoot common setup issues. Please provide:
      placeholder: |
        - Bot Version: v1.0.0
        - Node.js Version: v20.10.0
        - Operating System: Windows 10
        - Relevant config.js settings (e.g., Rates) - REMOVE secrets!
      render: markdown
    validations:
      required: true

  - type: textarea
    id: attempted-solutions
    attributes:
      label: 3. What steps have you already taken?
      description: Have you checked the Wiki? What solutions have you tried already?
      validations:
      required: false
