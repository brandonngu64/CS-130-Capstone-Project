import { getCharacterSpriteUrl } from './CharacterSprites';
import type { PlayerRenderState } from './RollbackPhysicsGame';
import { KOABLE_DURATION_TICKS } from './constants';

const PIP_DISPLAY_THRESHOLD = 4;

function colorToCss(hex: number): string {
  return `#${hex.toString(16).padStart(6, '0')}`;
}

function healthColor(health: number, maxHealth: number): string {
  const ratio = maxHealth > 0 ? Math.max(0, Math.min(1, health / maxHealth)) : 0;
  const r = Math.round(255 * ratio + 139 * (1 - ratio));
  const g = Math.round(255 * ratio);
  const b = Math.round(255 * ratio);
  return `rgb(${r},${g},${b})`;
}

export class SmashHud {
  private readonly element: HTMLElement;
  private koBarEnabled = false;

  constructor(parent: HTMLElement) {
    this.element = document.createElement('div');
    this.element.className = 'smash-hud';
    this.element.dataset.visible = 'false';
    parent.appendChild(this.element);
  }

  setVisible(visible: boolean): void {
    this.element.dataset.visible = visible ? 'true' : 'false';
  }

  setKoBarEnabled(enabled: boolean): void {
    this.koBarEnabled = enabled;
  }

  update(players: readonly PlayerRenderState[], localPlayerId: string): void {
    if (players.length === 0) {
      this.element.innerHTML = '';
      return;
    }

    const sorted = [...players].sort((a, b) => {
      if (a.id === localPlayerId) return -1;
      if (b.id === localPlayerId) return 1;
      return a.id.localeCompare(b.id);
    });

    this.element.innerHTML = sorted.map((p) => this.renderCard(p)).join('');
  }

  destroy(): void {
    this.element.remove();
  }

  private renderKoBar(player: PlayerRenderState): string {
    if (!this.koBarEnabled || player.eliminated) return '';

    const koable = player.koableTicksRemaining > 0;
    const inKnockback = player.knockbackTicksRemaining > 0;

    if (!koable && !inKnockback) return '';

    let fillClass: string;
    let fillPct: number;
    if (koable) {
      fillClass = 'smash-ko-bar-fill--active';
      fillPct = Math.round((player.koableTicksRemaining / KOABLE_DURATION_TICKS) * 100);
    } else {
      fillClass = 'smash-ko-bar-fill--airborne';
      fillPct = 100;
    }

    return `
      <div class="smash-ko-bar-wrap">
        <span class="smash-ko-bar-label">KOable</span>
        <div class="smash-ko-bar-track">
          <div class="smash-ko-bar-fill ${fillClass}" style="width:${fillPct}%"></div>
        </div>
      </div>
    `;
  }

  private renderCard(player: PlayerRenderState): string {
    const healthPct =
      player.maxHealth > 0 ? Math.round((player.health / player.maxHealth) * 100) : 0;
    const color = healthColor(player.health, player.maxHealth);
    const playerColor = colorToCss(player.color);

    let headshot = '';
    try {
      headshot = getCharacterSpriteUrl(
        player.characterId,
        `${player.characterId}_headshot`,
      );
    } catch {
      headshot = '';
    }

    const stocks = Math.max(0, player.stocks);
    let stockPips: string;
    if (stocks <= PIP_DISPLAY_THRESHOLD) {
      stockPips = Array.from({ length: stocks }, () =>
        `<span class="smash-stock-pip smash-stock-pip--filled"></span>`,
      ).join('');
    } else {
      stockPips = `<span class="smash-stock-pip smash-stock-pip--filled"></span><span class="smash-stock-count" style="color: white">× ${stocks}</span>`;
    }

    return `
      <div class="smash-card${player.eliminated ? ' smash-card--eliminated' : ''}">
        <div class="smash-card-portrait" style="background:${playerColor}">
          ${headshot ? `<img class="smash-card-headshot" src="${headshot}" alt="${player.characterId}" draggable="false" />` : ''}
        </div>
        <div class="smash-card-stats">
          <div class="smash-health-value" style="color:${color}">${healthPct}%</div>
          <div class="smash-stocks">${stockPips}</div>
          ${this.renderKoBar(player)}
        </div>
      </div>
    `;
  }
}
