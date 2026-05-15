alias: Calcio Live - תזכורות משחקים
description: שולח התראה 60/30/5 דקות לפני משחקים שסומנו

triggers:
  - trigger: time_pattern
    minutes: "/1"

conditions:
  - condition: template
    value_template: >
      {{ states('input_text.calcio_live_reminders') not in ['', 'unknown'] }}

actions:
  - variables:
      reminder_ids: >
        {{ states('input_text.calcio_live_reminders').split(',') | map('trim') | list }}
      matches: >
        {{ state_attr('sensor.YOUR_SENSOR_ENTITY', 'matches') or [] }}

  - repeat:
      for_each: "{{ matches }}"
      sequence:
        - variables:
            mid: >
              {{ repeat.item.home_team ~ '_' ~ repeat.item.away_team ~ '_' ~ (repeat.item.date or '').split(' ')[0] }}
        - condition: template
          value_template: "{{ mid in reminder_ids and repeat.item.state == 'pre' }}"
        - variables:
            date_part: "{{ (repeat.item.date or '').split(' ')[0] }}"
            time_part: "{{ (repeat.item.date or '').split(' ')[1] if ' ' in (repeat.item.date or '') else '00:00' }}"
            diff: >
              {% set d = date_part.split('/') %}
              {% set t = time_part.split(':') %}
              {% set match_dt = now().replace(
                day=d[0]|int, month=d[1]|int, year=d[2]|int,
                hour=t[0]|int, minute=t[1]|int, second=0, microsecond=0) %}
              {{ ((match_dt - now()).total_seconds() / 60) | round(0) | int }}
        - choose:
            - conditions:
                - condition: template
                  value_template: "{{ diff in [60, 30, 5] }}"
              sequence:
                - action: notify.mobile_app_YOUR_PHONE
                  data:
                    title: "⚽ בעוד {{ diff }} דקות!"
                    message: >
                      {{ repeat.item.home_team }} נגד {{ repeat.item.away_team }}
                      {% if repeat.item.venue and repeat.item.venue != 'N/A' %} | {{ repeat.item.venue }}{% endif %}

  - variables:
      clean: >
        {% set ns = namespace(keep=[]) %}
        {% for m in matches %}
          {% set mid = m.home_team ~ '_' ~ m.away_team ~ '_' ~ (m.date or '').split(' ')[0] %}
          {% if mid in reminder_ids and m.state == 'pre' %}
            {% set ns.keep = ns.keep + [mid] %}
          {% endif %}
        {% endfor %}
        {{ ns.keep | join(',') }}
  - action: input_text.set_value
    target:
      entity_id: input_text.calcio_live_reminders
    data:
      value: "{{ clean }}"
