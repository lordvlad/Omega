/**
 * A2UI v1.0 renderer over Mantine components.
 *
 * Renders an A2UI surface by traversing its component adjacency list starting
 * at `root`. Resolves `{ path: "/pointer" }` data bindings against the surface's
 * data model and writes input changes back in real time.
 */
import {
  Box,
  Button,
  Card,
  Checkbox,
  Chip,
  Divider,
  Group,
  Image,
  NumberInput,
  PasswordInput,
  Radio,
  Slider,
  Stack,
  Tabs,
  Text,
  TextInput,
  Textarea,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconArrowBack,
  IconArrowForward,
  IconBell,
  IconBellOff,
  IconCalendar,
  IconCamera,
  IconCheck,
  IconDots,
  IconDotsVertical,
  IconDownload,
  IconEdit,
  IconEye,
  IconEyeOff,
  IconFolder,
  IconHeart,
  IconHeartOff,
  IconHelp,
  IconHome,
  IconInfoCircle,
  IconLock,
  IconLockOpen,
  IconMail,
  IconMapPin,
  IconMenu2,
  IconPaperclip,
  IconPlayerPause,
  IconPhone,
  IconPhoto,
  IconPlayerPlay,
  IconPlayerTrackNext,
  IconPlayerTrackPrev,
  IconPlayerStop,
  IconPlus,
  IconPrinter,
  IconRefresh,
  IconSearch,
  IconSend,
  IconSettings,
  IconShare,
  IconShoppingCart,
  IconStar,
  IconStarHalf,
  IconStarOff,
  IconTrash,
  IconUpload,
  IconUser,
  IconVolume,
  IconVolume2,
  IconVolumeOff,
  IconX,
} from "@tabler/icons-react";
import React, { useCallback } from "react";

import type { A2uiAction, A2uiActionEvent, A2uiChildList, A2uiDataBinding } from "../../shared/a2ui.ts";
import { type ClientSurface, resolveActionContext, resolveDynamic, resolvePointer } from "../lib/a2ui.ts";

export interface A2UIRendererProps {
  surface: ClientSurface;
  onAction?: (
    surfaceId: string,
    action: A2uiActionEvent,
    context: Record<string, unknown>,
    dataModel?: Record<string, unknown>,
  ) => void;
  onUpdateData?: (surfaceId: string, path: string | undefined, value: unknown) => void;
}

/** Map A2UI icon names to Tabler icon components. */
function renderTablerIcon(name: string | undefined, size = 18): React.ReactNode {
  switch (name) {
    case "accountCircle":
    case "person":
      return <IconUser size={size} />;
    case "add":
      return <IconPlus size={size} />;
    case "arrowBack":
      return <IconArrowBack size={size} />;
    case "arrowForward":
      return <IconArrowForward size={size} />;
    case "attachFile":
      return <IconPaperclip size={size} />;
    case "calendarToday":
    case "event":
      return <IconCalendar size={size} />;
    case "call":
    case "phone":
      return <IconPhone size={size} />;
    case "camera":
      return <IconCamera size={size} />;
    case "check":
      return <IconCheck size={size} />;
    case "close":
      return <IconX size={size} />;
    case "delete":
      return <IconTrash size={size} />;
    case "download":
      return <IconDownload size={size} />;
    case "edit":
      return <IconEdit size={size} />;
    case "error":
    case "warning":
      return <IconAlertCircle size={size} />;
    case "favorite":
      return <IconHeart size={size} />;
    case "favoriteOff":
      return <IconHeartOff size={size} />;
    case "folder":
      return <IconFolder size={size} />;
    case "help":
      return <IconHelp size={size} />;
    case "home":
      return <IconHome size={size} />;
    case "info":
      return <IconInfoCircle size={size} />;
    case "locationOn":
      return <IconMapPin size={size} />;
    case "lock":
      return <IconLock size={size} />;
    case "lockOpen":
      return <IconLockOpen size={size} />;
    case "mail":
      return <IconMail size={size} />;
    case "pause":
      return <IconPlayerPause size={size} />;
    case "moreVert":
      return <IconDotsVertical size={size} />;
    case "moreHoriz":
      return <IconDots size={size} />;
    case "notifications":
      return <IconBell size={size} />;
    case "notificationsOff":
      return <IconBellOff size={size} />;
    case "photo":
      return <IconPhoto size={size} />;
    case "play":
      return <IconPlayerPlay size={size} />;
    case "print":
      return <IconPrinter size={size} />;
    case "refresh":
      return <IconRefresh size={size} />;
    case "search":
      return <IconSearch size={size} />;
    case "send":
      return <IconSend size={size} />;
    case "settings":
      return <IconSettings size={size} />;
    case "share":
      return <IconShare size={size} />;
    case "shoppingCart":
    case "payment":
      return <IconShoppingCart size={size} />;
    case "skipNext":
    case "fastForward":
      return <IconPlayerTrackNext size={size} />;
    case "skipPrevious":
    case "rewind":
      return <IconPlayerTrackPrev size={size} />;
    case "star":
      return <IconStar size={size} />;
    case "starHalf":
      return <IconStarHalf size={size} />;
    case "starOff":
      return <IconStarOff size={size} />;
    case "stop":
      return <IconPlayerStop size={size} />;
    case "upload":
      return <IconUpload size={size} />;
    case "visibility":
      return <IconEye size={size} />;
    case "visibilityOff":
      return <IconEyeOff size={size} />;
    case "volumeDown":
      return <IconVolume size={size} />;
    case "volumeMute":
    case "volumeOff":
      return <IconVolumeOff size={size} />;
    case "volumeUp":
      return <IconVolume2 size={size} />;
    default:
      return <IconHelp size={size} />;
  }
}

/** Map A2UI alignment terms to Mantine values. */
function mapAlign(align: unknown): "flex-start" | "center" | "flex-end" | "stretch" {
  switch (align) {
    case "start":
      return "flex-start";
    case "center":
      return "center";
    case "end":
      return "flex-end";
    case "stretch":
    default:
      return "stretch";
  }
}

/** Map A2UI justify terms to Mantine values. */
function mapJustify(
  justify: unknown,
): "flex-start" | "center" | "flex-end" | "space-between" | "space-around" | "space-evenly" {
  switch (justify) {
    case "center":
      return "center";
    case "end":
      return "flex-end";
    case "spaceBetween":
      return "space-between";
    case "spaceAround":
      return "space-around";
    case "spaceEvenly":
      return "space-evenly";
    case "start":
    default:
      return "flex-start";
  }
}

/** Extract bound data path from a dynamic property if it is a binding. */
function bindingPath(val: unknown): string | undefined {
  if (val && typeof val === "object" && "path" in val && typeof (val as A2uiDataBinding).path === "string") {
    return (val as A2uiDataBinding).path;
  }
  return undefined;
}

export function A2UIRenderer({ surface, onAction, onUpdateData }: A2UIRendererProps): React.ReactNode {
  const { components, dataModel, surfaceId, sendDataModel } = surface;

  const handleAction = useCallback(
    (action: A2uiAction | undefined, scope?: unknown, index?: number) => {
      if (!action?.event || !onAction) return;
      const ctx = resolveActionContext(action.event.context, dataModel, scope, index);
      onAction(surfaceId, action.event, ctx, sendDataModel ? dataModel : undefined);
    },
    [surfaceId, dataModel, sendDataModel, onAction],
  );

  const handleUpdate = useCallback(
    (path: string | undefined, value: unknown) => {
      if (!path || !onUpdateData) return;
      onUpdateData(surfaceId, path, value);
    },
    [surfaceId, onUpdateData],
  );

  const renderComponent = (
    id: string,
    scope?: unknown,
    index?: number,
    keyOverride?: string,
  ): React.ReactNode => {
    const comp = components.get(id);
    if (!comp) {
      return (
        <Text key={keyOverride ?? id} size="xs" c="dimmed" fs="italic">
          [Missing #{id}]
        </Text>
      );
    }

    const key = keyOverride ?? `${id}-${index ?? 0}`;
    const weight = typeof comp.weight === "number" ? comp.weight : undefined;
    const style: React.CSSProperties = weight !== undefined ? { flexGrow: weight, flexBasis: 0 } : {};

    switch (comp.component) {
      case "Text": {
        const textVal = resolveDynamic<string>(comp.text as any, dataModel, scope, index);
        const variant = comp.variant;
        return (
          <Text
            key={key}
            size={variant === "caption" ? "xs" : "sm"}
            c={variant === "caption" ? "dimmed" : undefined}
            fw={variant === "heading" ? 600 : undefined}
            style={style}
          >
            {textVal ?? ""}
          </Text>
        );
      }

      case "Icon": {
        const nameVal = resolveDynamic<string>(comp.name as any, dataModel, scope, index);
        return (
          <Box key={key} style={{ display: "inline-flex", alignItems: "center", ...style }}>
            {renderTablerIcon(nameVal)}
          </Box>
        );
      }

      case "Image": {
        const url = resolveDynamic<string>(comp.url as any, dataModel, scope, index);
        const description = resolveDynamic<string>(comp.description as any, dataModel, scope, index);
        const fit = (comp.fit as "contain" | "cover" | "fill") ?? "cover";
        const variant = comp.variant as string | undefined;
        const radius = variant === "avatar" || variant === "icon" ? "xl" : "sm";
        const w = variant === "avatar" ? 40 : variant === "icon" ? 24 : "100%";
        const h = variant === "avatar" ? 40 : variant === "icon" ? 24 : "auto";
        return (
          <Image
            key={key}
            src={url}
            alt={description ?? ""}
            fit={fit}
            radius={radius}
            w={w}
            h={h}
            style={style}
          />
        );
      }

      case "AudioPlayer": {
        const url = resolveDynamic<string>(comp.url as any, dataModel, scope, index);
        return (
          <Box key={key} style={{ width: "100%", ...style }}>
            {url ? <audio controls src={url} style={{ width: "100%" }} /> : null}
          </Box>
        );
      }

      case "Video": {
        const url = resolveDynamic<string>(comp.url as any, dataModel, scope, index);
        const poster = resolveDynamic<string>(comp.posterUrl as any, dataModel, scope, index);
        return (
          <Box key={key} style={{ width: "100%", ...style }}>
            {url ? (
              <video
                controls
                src={url}
                poster={poster}
                style={{ width: "100%", borderRadius: "var(--mantine-radius-sm)" }}
              />
            ) : null}
          </Box>
        );
      }

      case "Card": {
        const childId = comp.child as string;
        return (
          <Card key={key} withBorder radius="md" p="md" shadow="sm" style={style}>
            {childId ? renderComponent(childId, scope, index) : null}
          </Card>
        );
      }

      case "Divider": {
        const axis = comp.axis === "vertical" ? "vertical" : "horizontal";
        return <Divider key={key} orientation={axis} my="xs" style={style} />;
      }

      case "Row": {
        const justify = mapJustify(comp.justify);
        const align = mapAlign(comp.align);
        return (
          <Group key={key} justify={justify} align={align} gap="sm" wrap="nowrap" style={style}>
            {renderChildren(comp.children as A2uiChildList, scope, index)}
          </Group>
        );
      }

      case "Column": {
        const justify = mapJustify(comp.justify);
        const align = mapAlign(comp.align);
        return (
          <Stack key={key} justify={justify} align={align} gap="sm" style={style}>
            {renderChildren(comp.children as A2uiChildList, scope, index)}
          </Stack>
        );
      }

      case "List": {
        const isHoriz = comp.direction === "horizontal";
        const align = mapAlign(comp.align);
        if (isHoriz) {
          return (
            <Group key={key} align={align} gap="sm" wrap="nowrap" style={style}>
              {renderChildren(comp.children as A2uiChildList, scope, index)}
            </Group>
          );
        }
        return (
          <Stack key={key} align={align} gap="sm" style={style}>
            {renderChildren(comp.children as A2uiChildList, scope, index)}
          </Stack>
        );
      }

      case "Tabs": {
        const tabList = (comp.tabs as Array<{ title: any; child: string }>) ?? [];
        return (
          <Tabs key={key} defaultValue="0" style={style}>
            <Tabs.List>
              {tabList.map((t, i) => {
                const title = resolveDynamic<string>(t.title, dataModel, scope, index);
                return (
                  <Tabs.Tab key={String(i)} value={String(i)}>
                    {title ?? `Tab ${i + 1}`}
                  </Tabs.Tab>
                );
              })}
            </Tabs.List>
            {tabList.map((t, i) => (
              <Tabs.Panel key={String(i)} value={String(i)} pt="sm">
                {t.child ? renderComponent(t.child, scope, index) : null}
              </Tabs.Panel>
            ))}
          </Tabs>
        );
      }

      case "Button": {
        const childId = comp.child as string;
        const variant = comp.variant;
        const buttonVariant =
          variant === "primary" ? "filled" : variant === "borderless" ? "subtle" : "light";
        const action = comp.action as A2uiAction | undefined;

        return (
          <Button
            key={key}
            variant={buttonVariant}
            color="cyan"
            size="sm"
            onClick={() => handleAction(action, scope, index)}
            style={style}
          >
            {childId ? renderComponent(childId, scope, index) : "Button"}
          </Button>
        );
      }

      case "TextField": {
        const label = resolveDynamic<string>(comp.label as any, dataModel, scope, index);
        const placeholder = resolveDynamic<string>(comp.placeholder as any, dataModel, scope, index);
        const path = bindingPath(comp.value);
        const currentVal = resolveDynamic<string>(comp.value as any, dataModel, scope, index) ?? "";
        const variant = comp.variant as string | undefined;

        if (variant === "longText") {
          return (
            <Textarea
              key={key}
              label={label}
              placeholder={placeholder}
              value={currentVal}
              onChange={e => handleUpdate(path, e.currentTarget.value)}
              minRows={3}
              style={style}
            />
          );
        }

        if (variant === "obscured") {
          return (
            <PasswordInput
              key={key}
              label={label}
              placeholder={placeholder}
              value={currentVal}
              onChange={e => handleUpdate(path, e.currentTarget.value)}
              style={style}
            />
          );
        }

        if (variant === "number") {
          return (
            <NumberInput
              key={key}
              label={label}
              placeholder={placeholder}
              value={currentVal === "" ? "" : Number(currentVal)}
              onChange={v => handleUpdate(path, v)}
              style={style}
            />
          );
        }

        return (
          <TextInput
            key={key}
            label={label}
            placeholder={placeholder}
            value={currentVal}
            onChange={e => handleUpdate(path, e.currentTarget.value)}
            style={style}
          />
        );
      }

      case "CheckBox": {
        const label = resolveDynamic<string>(comp.label as any, dataModel, scope, index);
        const path = bindingPath(comp.value);
        const currentVal = Boolean(resolveDynamic<boolean>(comp.value as any, dataModel, scope, index));

        return (
          <Checkbox
            key={key}
            label={label}
            checked={currentVal}
            color="cyan"
            onChange={e => handleUpdate(path, e.currentTarget.checked)}
            style={style}
          />
        );
      }

      case "ChoicePicker": {
        const label = resolveDynamic<string>(comp.label as any, dataModel, scope, index);
        const path = bindingPath(comp.value);
        const rawOptions = (comp.options as Array<{ label: any; value: string }>) ?? [];
        const options = rawOptions.map(opt => ({
          value: opt.value,
          label: resolveDynamic<string>(opt.label, dataModel, scope, index) ?? opt.value,
        }));
        const variant = comp.variant ?? "mutuallyExclusive";
        const displayStyle = comp.displayStyle ?? "checkbox";

        if (variant === "mutuallyExclusive") {
          const rawVal = resolveDynamic<string | string[]>(comp.value as any, dataModel, scope, index);
          const currentVal = Array.isArray(rawVal) ? (rawVal[0] ?? "") : (rawVal ?? "");

          if (displayStyle === "chips") {
            return (
              <Box key={key} style={style}>
                {label ? (
                  <Text size="xs" fw={500} mb={4}>
                    {label}
                  </Text>
                ) : null}
                <Chip.Group
                  value={currentVal}
                  onChange={val => handleUpdate(path, Array.isArray(rawVal) ? [val] : val)}
                >
                  <Group gap="xs">
                    {options.map(opt => (
                      <Chip key={opt.value} value={opt.value} size="sm" color="cyan">
                        {opt.label}
                      </Chip>
                    ))}
                  </Group>
                </Chip.Group>
              </Box>
            );
          }

          return (
            <Radio.Group
              key={key}
              label={label}
              value={currentVal}
              onChange={val => handleUpdate(path, Array.isArray(rawVal) ? [val] : val)}
              style={style}
            >
              <Group mt="xs" gap="sm">
                {options.map(opt => (
                  <Radio key={opt.value} value={opt.value} label={opt.label} color="cyan" />
                ))}
              </Group>
            </Radio.Group>
          );
        }

        const rawVal = resolveDynamic<string[]>(comp.value as any, dataModel, scope, index);
        const currentVals = Array.isArray(rawVal) ? rawVal : [];

        return (
          <Checkbox.Group
            key={key}
            label={label}
            value={currentVals}
            onChange={vals => handleUpdate(path, vals)}
            style={style}
          >
            <Group mt="xs" gap="sm">
              {options.map(opt => (
                <Checkbox key={opt.value} value={opt.value} label={opt.label} color="cyan" />
              ))}
            </Group>
          </Checkbox.Group>
        );
      }

      case "Slider": {
        const label = resolveDynamic<string>(comp.label as any, dataModel, scope, index);
        const path = bindingPath(comp.value);
        const min = typeof comp.min === "number" ? comp.min : 0;
        const max = typeof comp.max === "number" ? comp.max : 100;
        const steps = typeof comp.steps === "number" ? comp.steps : undefined;
        const step = steps ? (max - min) / steps : 1;
        const currentVal = Number(resolveDynamic<number>(comp.value as any, dataModel, scope, index) ?? min);

        return (
          <Box key={key} style={style}>
            {label ? (
              <Text size="xs" fw={500} mb={4}>
                {label}
              </Text>
            ) : null}
            <Slider
              min={min}
              max={max}
              step={step}
              value={currentVal}
              color="cyan"
              onChange={val => handleUpdate(path, val)}
            />
          </Box>
        );
      }

      case "DateTimeInput": {
        const label = resolveDynamic<string>(comp.label as any, dataModel, scope, index);
        const path = bindingPath(comp.value);
        const currentVal = resolveDynamic<string>(comp.value as any, dataModel, scope, index) ?? "";
        const enableTime = comp.enableTime === true;
        const inputType = enableTime ? "datetime-local" : "date";

        return (
          <TextInput
            key={key}
            type={inputType}
            label={label}
            value={currentVal}
            onChange={e => handleUpdate(path, e.currentTarget.value)}
            style={style}
          />
        );
      }

      default:
        return (
          <Text key={key} size="xs" c="dimmed" fs="italic">
            [Unknown component: {comp.component}]
          </Text>
        );
    }
  };

  const renderChildren = (
    children: A2uiChildList | undefined,
    scope?: unknown,
    index?: number,
  ): React.ReactNode => {
    if (!children) return null;

    if (Array.isArray(children)) {
      return children.map(childId => renderComponent(childId, scope, index));
    }

    if (typeof children === "object" && "componentId" in children && "path" in children) {
      const template = children as { componentId: string; path: string };
      const listData = resolvePointer(dataModel, template.path, scope, index);
      if (Array.isArray(listData)) {
        return listData.map((item, i) =>
          renderComponent(template.componentId, item, i, `${template.componentId}-${i}`),
        );
      }
    }

    return null;
  };

  const rootComponent = components.get("root");
  if (!rootComponent) {
    return (
      <Box p="md">
        <Text size="xs" c="dimmed">
          Surface "{surfaceId}" has no root component mounted.
        </Text>
      </Box>
    );
  }

  return <Box className="omega-a2ui-surface">{renderComponent("root")}</Box>;
}
