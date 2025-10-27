name: 🐛 Bug Report
about: Report a bug or an unexpected error in the Steam-Card-Bot-PRO.
labels: ["bug"]
assignees: "killerboyyy777"
title: "[BUG]: Short description of the issue"

body:
  - type: markdown
    attributes:
      value: |
        ## Thank you for helping us!
        Please fill out this report clearly and completely. The more information you provide, the faster we can fix the issue.

  - type: textarea
    id: description
    attributes:
      label: 1. Describe the Bug
      description: A clear and concise description of what the bug is. What exactly went wrong, and when did it start occurring?
    validations:
      required: true

  - type: input
    id: bot-version
    attributes:
      label: 2. Bot Version
      description: Which version of the bot are you running? (e.g., v1.0.0, or the date/commit hash if using the master branch)
      placeholder: v1.0.0
    validations:
      required: true

  - type: textarea
    id: reproduction-steps
    attributes:
      label: 3. Steps to Reproduce
      description: |
        Please list the exact steps to reproduce the behavior. 
        Include exact user commands and the sequence of events.
      placeholder: |
        1. Start the bot.
        2. User sends command: !SellTF 10
        3. Bot fails to send the trade offer.
    validations:
      required: true

  - type: textarea
    id: config-snippet
    attributes:
      label: 4. Relevant Configuration Snippets
      description: Please paste the relevant sections from your config.js (e.g., Rates, Restrictions). REMOVE any sensitive information like passwords or secrets!
      render: yaml
      placeholder: |
        Rates:
          SELL:
            TF2_To_Gems: 3900
            
  - type: textarea
    id: expected-behavior
    attributes:
      label: 5. Expected Behavior
      description: A clear and concise description of what you expected the bot to do.
    validations:
      required: true

  - type: textarea
    id: console-error
    attributes:
      label: 6. Console Output or Error
      description: If the bot crashed or showed an error, please paste the full console output or stack trace here.
      render: bash

  - type: dropdown
    id: os
    attributes:
      label: 7. Operating System
      description: Which OS is the bot running on?
      options:
        - Windows
        - macOS
        - Linux (specify distribution in the context section)
        - Docker
        - Other
    validations:
      required: true

  - type: input
    id: node-version
    attributes:
      label: 8. Node.js Version
      description: Please run `node -v` in your terminal and provide the output.
      placeholder: v20.10.0
    validations:
      required: true

  - type: markdown
    attributes:
      value: |
        ---
        ## Additional Context
        If applicable, please attach any **screenshots** to the issue submission. This can often speed up the debugging process significantly!
