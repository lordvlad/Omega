import {
  AreaChart,
  BarChart,
  CompositeChart,
  DonutChart,
  LineChart,
  PieChart,
  RadarChart,
  ScatterChart,
  Sparkline,
} from "@mantine/charts";
/**
 * A2UI v1.0 renderer over Mantine components.
 *
 * Renders an A2UI surface by traversing its component adjacency list starting
 * at `root`. Resolves `{ path: "/pointer" }` data bindings against the surface's
 * data model and writes input changes back in real time.
 */
import {
  Accordion,
  Alert,
  Anchor,
  Avatar,
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
  Chip,
  Code,
  Divider,
  Group,
  Image,
  NumberInput,
  Paper,
  PasswordInput,
  Progress,
  Radio,
  Rating,
  RingProgress,
  SegmentedControl,
  Skeleton,
  Slider,
  Stack,
  Switch,
  Table,
  Tabs,
  Text,
  TextInput,
  Textarea,
  Timeline,
  Tooltip,
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
import { MermaidChart } from "./MermaidChart.tsx";
import { MindMap, type MindMapNodeData } from "./MindMap.tsx";

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

/**
 * Minimum width of one weighted `Row` child before the row wraps to fewer
 * columns. Small enough that four metric cards still fit a phone-width
 * `Row` at one per line without feeling cramped; wide enough that a chart
 * card never renders too thin for its axis labels to stay legible.
 */
const GRID_CELL_MIN_WIDTH = 170;

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
    // Weighted children are the "equal card/chart grid" convention every
    // dashboard surface uses (metrics row, charts row, …). `flexBasis: 0`
    // alone lets a `Row` squeeze them to unreadable widths on a narrow
    // drawer/viewport; a minimum floor makes the row (now `wrap: "wrap"`)
    // fold into fewer columns instead, so the number of columns is
    // responsive rather than fixed by however many children the author put
    // in the row.
    const style: React.CSSProperties =
      weight !== undefined ? { flexGrow: weight, flexBasis: 0, minWidth: GRID_CELL_MIN_WIDTH } : {};

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
            style={{ whiteSpace: "pre-wrap", ...style }}
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
          <Group key={key} justify={justify} align={align} gap="sm" wrap="wrap" style={style}>
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
            <Group key={key} align={align} gap="sm" wrap="wrap" style={style}>
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
        const defaultValue = (comp.defaultValue as string) ?? "0";
        return (
          <Tabs key={key} defaultValue={defaultValue} style={style}>
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
      case "Badge": {
        const label = resolveDynamic<string>(comp.label as any, dataModel, scope, index);
        const color = (comp.color as string) ?? "cyan";
        const variant = (comp.variant as any) ?? "light";
        const size = (comp.size as any) ?? "sm";
        return (
          <Badge key={key} color={color} variant={variant} size={size} style={style}>
            {label ?? ""}
          </Badge>
        );
      }

      case "Alert": {
        const title = resolveDynamic<string>(comp.title as any, dataModel, scope, index);
        const text = resolveDynamic<string>(comp.text as any, dataModel, scope, index);
        const color = (comp.color as string) ?? "cyan";
        const variant = (comp.variant as any) ?? "light";
        const iconName = comp.icon as string | undefined;
        const iconNode = iconName ? renderTablerIcon(iconName, 16) : undefined;
        const childId = comp.child as string | undefined;
        return (
          <Alert key={key} title={title} color={color} variant={variant} icon={iconNode} style={style}>
            {text ?? (childId ? renderComponent(childId, scope, index) : null)}
          </Alert>
        );
      }

      case "Progress": {
        const value = Number(resolveDynamic<number>(comp.value as any, dataModel, scope, index) ?? 0);
        const color = (comp.color as string) ?? "cyan";
        const size = (comp.size as any) ?? "md";
        const striped = comp.striped === true;
        const animated = comp.animated === true;
        return (
          <Progress
            key={key}
            value={value}
            color={color}
            size={size}
            striped={striped}
            animated={animated}
            style={style}
          />
        );
      }

      case "RingProgress": {
        const value = Number(resolveDynamic<number>(comp.value as any, dataModel, scope, index) ?? 0);
        const label = resolveDynamic<string>(comp.label as any, dataModel, scope, index);
        const color = (comp.color as string) ?? "cyan";
        const size = typeof comp.size === "number" ? comp.size : 80;
        const thickness = typeof comp.thickness === "number" ? comp.thickness : 8;
        return (
          <RingProgress
            key={key}
            size={size}
            thickness={thickness}
            sections={[{ value, color }]}
            label={
              label ? (
                <Text size="xs" ta="center">
                  {label}
                </Text>
              ) : undefined
            }
            style={style}
          />
        );
      }

      case "Avatar": {
        const src = resolveDynamic<string>(comp.src as any, dataModel, scope, index);
        const name = resolveDynamic<string>(comp.name as any, dataModel, scope, index);
        const size = (comp.size as any) ?? "md";
        const radius = (comp.radius as any) ?? "xl";
        const color = (comp.color as string) ?? "cyan";
        return (
          <Avatar key={key} src={src} name={name} size={size} radius={radius} color={color} style={style}>
            {name ? name.slice(0, 2).toUpperCase() : undefined}
          </Avatar>
        );
      }

      case "Switch": {
        const label = resolveDynamic<string>(comp.label as any, dataModel, scope, index);
        const description = resolveDynamic<string>(comp.description as any, dataModel, scope, index);
        const path = bindingPath(comp.value);
        const checked = Boolean(resolveDynamic<boolean>(comp.value as any, dataModel, scope, index));
        const color = (comp.color as string) ?? "cyan";
        return (
          <Switch
            key={key}
            label={label}
            description={description}
            checked={checked}
            color={color}
            onChange={e => handleUpdate(path, e.currentTarget.checked)}
            style={style}
          />
        );
      }

      case "SegmentedControl": {
        const path = bindingPath(comp.value);
        const currentVal = String(resolveDynamic<string>(comp.value as any, dataModel, scope, index) ?? "");
        const rawOptions = (comp.options as Array<{ label: any; value: string }>) ?? [];
        const data = rawOptions.map(opt => ({
          value: opt.value,
          label: resolveDynamic<string>(opt.label, dataModel, scope, index) ?? opt.value,
        }));
        const color = (comp.color as string) ?? "cyan";
        const size = (comp.size as any) ?? "sm";
        return (
          <SegmentedControl
            key={key}
            data={data}
            value={currentVal}
            color={color}
            size={size}
            onChange={val => handleUpdate(path, val)}
            style={style}
          />
        );
      }

      case "Rating": {
        const path = bindingPath(comp.value);
        const currentVal = Number(resolveDynamic<number>(comp.value as any, dataModel, scope, index) ?? 0);
        const count = typeof comp.count === "number" ? comp.count : 5;
        const color = (comp.color as string) ?? "yellow";
        const size = (comp.size as any) ?? "md";
        const readOnly = comp.readOnly === true;
        return (
          <Rating
            key={key}
            value={currentVal}
            count={count}
            color={color}
            size={size}
            readOnly={readOnly}
            onChange={val => handleUpdate(path, val)}
            style={style}
          />
        );
      }

      case "Accordion": {
        const rawItems = (comp.items as Array<{ title: any; child: string; value?: string }>) ?? [];
        const variant = (comp.variant as any) ?? "default";
        const defaultValue = (comp.defaultValue as string) ?? rawItems[0]?.value ?? "0";
        return (
          <Accordion key={key} variant={variant} defaultValue={defaultValue} style={style}>
            {rawItems.map((item, i) => {
              const val = item.value ?? String(i);
              const title = resolveDynamic<string>(item.title, dataModel, scope, index);
              return (
                <Accordion.Item key={val} value={val}>
                  <Accordion.Control>{title ?? `Section ${i + 1}`}</Accordion.Control>
                  <Accordion.Panel>
                    {item.child ? renderComponent(item.child, scope, index) : null}
                  </Accordion.Panel>
                </Accordion.Item>
              );
            })}
          </Accordion>
        );
      }

      case "Table": {
        const headers = (comp.headers as any[]) ?? [];
        const rows = (comp.rows as any[][]) ?? [];
        const striped = comp.striped === true;
        const highlightOnHover = comp.highlightOnHover === true;
        return (
          <Table.ScrollContainer key={key} minWidth={360} style={style}>
            <Table striped={striped} highlightOnHover={highlightOnHover}>
              {headers.length > 0 ? (
                <Table.Thead>
                  <Table.Tr>
                    {headers.map((h, i) => (
                      <Table.Th key={String(i)}>
                        {resolveDynamic<string>(h, dataModel, scope, index) ?? ""}
                      </Table.Th>
                    ))}
                  </Table.Tr>
                </Table.Thead>
              ) : null}
              <Table.Tbody>
                {rows.map((row, rIdx) => (
                  <Table.Tr key={String(rIdx)}>
                    {(row ?? []).map((cell, cIdx) => (
                      <Table.Td key={String(cIdx)}>
                        {resolveDynamic<string>(cell, dataModel, scope, index) ?? ""}
                      </Table.Td>
                    ))}
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        );
      }

      case "Code": {
        const code = resolveDynamic<string>(comp.code as any, dataModel, scope, index) ?? "";
        const block = comp.block !== false;
        return (
          <Code key={key} block={block} style={style}>
            {code}
          </Code>
        );
      }

      case "Timeline": {
        const rawItems =
          (comp.items as Array<{ title: any; description: any; time: any; bullet?: string }>) ?? [];
        const active = Number(resolveDynamic<number>(comp.active as any, dataModel, scope, index) ?? 0);
        const color = (comp.color as string) ?? "cyan";
        return (
          <Timeline key={key} active={active} color={color} style={style}>
            {rawItems.map((item, i) => {
              const title = resolveDynamic<string>(item.title, dataModel, scope, index);
              const desc = resolveDynamic<string>(item.description, dataModel, scope, index);
              const time = resolveDynamic<string>(item.time, dataModel, scope, index);
              const bullet = item.bullet ? renderTablerIcon(item.bullet, 12) : undefined;
              return (
                <Timeline.Item key={String(i)} title={title} bullet={bullet}>
                  {desc ? (
                    <Text c="dimmed" size="xs">
                      {desc}
                    </Text>
                  ) : null}
                  {time ? (
                    <Text size="xs" mt={4}>
                      {time}
                    </Text>
                  ) : null}
                </Timeline.Item>
              );
            })}
          </Timeline>
        );
      }

      case "Paper": {
        const childId = comp.child as string | undefined;
        const shadow = (comp.shadow as any) ?? "xs";
        const radius = (comp.radius as any) ?? "md";
        const withBorder = comp.withBorder !== false;
        const p = (comp.p as any) ?? "md";
        return (
          <Paper key={key} shadow={shadow} radius={radius} withBorder={withBorder} p={p} style={style}>
            {childId
              ? renderComponent(childId, scope, index)
              : renderChildren(comp.children as A2uiChildList, scope, index)}
          </Paper>
        );
      }

      case "Anchor": {
        const href = resolveDynamic<string>(comp.href as any, dataModel, scope, index) ?? "#";
        const text = resolveDynamic<string>(comp.text as any, dataModel, scope, index);
        const childId = comp.child as string | undefined;
        const target = (comp.target as string) ?? "_blank";
        const underline = (comp.underline as any) ?? "hover";
        return (
          <Anchor key={key} href={href} target={target} underline={underline} color="cyan" style={style}>
            {text ?? (childId ? renderComponent(childId, scope, index) : href)}
          </Anchor>
        );
      }

      case "Skeleton": {
        const height = typeof comp.height === "number" ? comp.height : 20;
        const width = typeof comp.width === "number" || typeof comp.width === "string" ? comp.width : "100%";
        const circle = comp.circle === true;
        const animate = comp.animate !== false;
        return (
          <Skeleton key={key} height={height} width={width} circle={circle} animate={animate} style={style} />
        );
      }

      case "Tooltip": {
        const label = resolveDynamic<string>(comp.label as any, dataModel, scope, index) ?? "";
        const childId = comp.child as string;
        return (
          <Tooltip key={key} label={label}>
            <Box style={{ display: "inline-block", ...style }}>
              {childId ? renderComponent(childId, scope, index) : null}
            </Box>
          </Tooltip>
        );
      }
      case "AreaChart": {
        const rawData = resolveDynamic<any[]>(comp.data as any, dataModel, scope, index);
        const chartData = Array.isArray(rawData) ? rawData : [];
        const dataKey = (comp.dataKey as string) ?? "x";
        const rawSeries = (comp.series as Array<{ name: string; color?: string; label?: string }>) ?? [];
        const series = rawSeries.map((s, i) => ({
          name: s.name,
          color: s.color || (i === 0 ? "cyan" : i === 1 ? "plum" : "teal"),
          label: s.label,
        }));
        const height = typeof comp.height === "number" ? comp.height : 240;
        const curveType = (comp.curveType as any) ?? "monotone";
        const withLegend = comp.withLegend === true;
        const withTooltip = comp.withTooltip !== false;
        const withDots = comp.withDots === true;
        return (
          <Box key={key} style={{ width: "100%", ...style }}>
            <AreaChart
              h={height}
              data={chartData}
              dataKey={dataKey}
              series={series}
              curveType={curveType}
              withLegend={withLegend}
              withTooltip={withTooltip}
              withDots={withDots}
            />
          </Box>
        );
      }

      case "BarChart": {
        const rawData = resolveDynamic<any[]>(comp.data as any, dataModel, scope, index);
        const chartData = Array.isArray(rawData) ? rawData : [];
        const dataKey = (comp.dataKey as string) ?? "x";
        const rawSeries = (comp.series as Array<{ name: string; color?: string; label?: string }>) ?? [];
        const series = rawSeries.map((s, i) => ({
          name: s.name,
          color: s.color || (i === 0 ? "cyan" : i === 1 ? "plum" : "teal"),
          label: s.label,
        }));
        const height = typeof comp.height === "number" ? comp.height : 240;
        const chartType = (comp.type as any) ?? "default";
        const withLegend = comp.withLegend === true;
        const withTooltip = comp.withTooltip !== false;
        return (
          <Box key={key} style={{ width: "100%", ...style }}>
            <BarChart
              h={height}
              data={chartData}
              dataKey={dataKey}
              series={series}
              type={chartType}
              withLegend={withLegend}
              withTooltip={withTooltip}
            />
          </Box>
        );
      }

      case "LineChart": {
        const rawData = resolveDynamic<any[]>(comp.data as any, dataModel, scope, index);
        const chartData = Array.isArray(rawData) ? rawData : [];
        const dataKey = (comp.dataKey as string) ?? "x";
        const rawSeries = (comp.series as Array<{ name: string; color?: string; label?: string }>) ?? [];
        const series = rawSeries.map((s, i) => ({
          name: s.name,
          color: s.color || (i === 0 ? "cyan" : i === 1 ? "plum" : "teal"),
          label: s.label,
        }));
        const height = typeof comp.height === "number" ? comp.height : 240;
        const curveType = (comp.curveType as any) ?? "monotone";
        const withLegend = comp.withLegend === true;
        const withTooltip = comp.withTooltip !== false;
        const withDots = comp.withDots !== false;
        return (
          <Box key={key} style={{ width: "100%", ...style }}>
            <LineChart
              h={height}
              data={chartData}
              dataKey={dataKey}
              series={series}
              curveType={curveType}
              withLegend={withLegend}
              withTooltip={withTooltip}
              withDots={withDots}
            />
          </Box>
        );
      }
      case "CompositeChart": {
        const rawData = resolveDynamic<any[]>(comp.data as any, dataModel, scope, index);
        const chartData = Array.isArray(rawData) ? rawData : [];
        const dataKey = (comp.dataKey as string) ?? "x";
        const rawSeries =
          (comp.series as Array<{
            name: string;
            color?: string;
            type?: "line" | "area" | "bar";
            label?: string;
          }>) ?? [];
        const series = rawSeries.map((s, i) => ({
          name: s.name,
          color: s.color || (i === 0 ? "cyan" : i === 1 ? "plum" : "teal"),
          type: s.type || "line",
          label: s.label,
        }));
        const height = typeof comp.height === "number" ? comp.height : 240;
        const curveType = (comp.curveType as any) ?? "monotone";
        const withLegend = comp.withLegend === true;
        const withTooltip = comp.withTooltip !== false;
        return (
          <Box key={key} style={{ width: "100%", ...style }}>
            <CompositeChart
              h={height}
              data={chartData}
              dataKey={dataKey}
              series={series}
              curveType={curveType}
              withLegend={withLegend}
              withTooltip={withTooltip}
            />
          </Box>
        );
      }

      case "ScatterChart": {
        const rawData = resolveDynamic<any[]>(comp.data as any, dataModel, scope, index);
        const chartData = Array.isArray(rawData) ? rawData : [];
        const dataKey = (comp.dataKey as { x: string; y: string }) ?? { x: "x", y: "y" };
        const height = typeof comp.height === "number" ? comp.height : 240;
        const withTooltip = comp.withTooltip !== false;
        return (
          <Box key={key} style={{ width: "100%", ...style }}>
            <ScatterChart h={height} data={chartData} dataKey={dataKey} withTooltip={withTooltip} />
          </Box>
        );
      }

      case "DonutChart": {
        const rawData = resolveDynamic<any[]>(comp.data as any, dataModel, scope, index);
        const chartData = Array.isArray(rawData) ? rawData : [];
        const size = typeof comp.size === "number" ? comp.size : 160;
        const thickness = typeof comp.thickness === "number" ? comp.thickness : 16;
        const withLabels = comp.withLabels === true;
        const withTooltip = comp.withTooltip !== false;
        const chartLabel = resolveDynamic<string>(comp.chartLabel as any, dataModel, scope, index);
        return (
          <Box key={key} style={{ display: "flex", justifyContent: "center", ...style }}>
            <DonutChart
              data={chartData}
              size={size}
              thickness={thickness}
              withLabels={withLabels}
              withTooltip={withTooltip}
              chartLabel={chartLabel}
            />
          </Box>
        );
      }

      case "PieChart": {
        const rawData = resolveDynamic<any[]>(comp.data as any, dataModel, scope, index);
        const chartData = Array.isArray(rawData) ? rawData : [];
        const size = typeof comp.size === "number" ? comp.size : 160;
        const withLabels = comp.withLabels === true;
        const withTooltip = comp.withTooltip !== false;
        return (
          <Box key={key} style={{ display: "flex", justifyContent: "center", ...style }}>
            <PieChart data={chartData} size={size} withLabels={withLabels} withTooltip={withTooltip} />
          </Box>
        );
      }

      case "RadarChart": {
        const rawData = resolveDynamic<any[]>(comp.data as any, dataModel, scope, index);
        const chartData = Array.isArray(rawData) ? rawData : [];
        const dataKey = (comp.dataKey as string) ?? "name";
        const rawSeries = (comp.series as Array<{ name: string; color?: string }>) ?? [];
        const series = rawSeries.map((s, i) => ({
          name: s.name,
          color: s.color || (i === 0 ? "cyan" : i === 1 ? "plum" : "teal"),
        }));
        const withPolarGrid = comp.withPolarGrid !== false;
        return (
          <Box key={key} style={{ display: "flex", justifyContent: "center", width: "100%", ...style }}>
            <RadarChart data={chartData} dataKey={dataKey} series={series} withPolarGrid={withPolarGrid} />
          </Box>
        );
      }

      case "Sparkline": {
        const rawData = resolveDynamic<number[]>(comp.data as any, dataModel, scope, index);
        const chartData = Array.isArray(rawData) ? rawData : [];
        const height = typeof comp.height === "number" ? comp.height : 40;
        const color = (comp.color as string) ?? "cyan";
        const curveType = (comp.curveType as any) ?? "natural";
        const fillOpacity = typeof comp.fillOpacity === "number" ? comp.fillOpacity : 0.2;
        return (
          <Box key={key} style={{ width: "100%", ...style }}>
            <Sparkline
              h={height}
              data={chartData}
              color={color}
              curveType={curveType}
              fillOpacity={fillOpacity}
            />
          </Box>
        );
      }
      case "MindMap":
      case "Mindmap": {
        const rawData = resolveDynamic<MindMapNodeData>(comp.data as any, dataModel, scope, index);
        const widthVal = resolveDynamic<number | string>(comp.width as any, dataModel, scope, index) ?? 800;
        const heightVal = resolveDynamic<number | string>(comp.height as any, dataModel, scope, index) ?? 500;
        const titleVal = resolveDynamic<string>(comp.title as any, dataModel, scope, index);
        const action = comp.action as A2uiAction | undefined;

        if (!rawData || typeof rawData !== "object") {
          return (
            <Text key={key} size="xs" c="dimmed" fs="italic">
              [MindMap: missing or invalid data]
            </Text>
          );
        }

        return (
          <Box key={key} style={style}>
            <MindMap
              data={rawData}
              width={widthVal}
              height={heightVal}
              title={titleVal}
              onNodeClick={node => {
                if (action) {
                  handleAction(action, node, index);
                }
              }}
            />
          </Box>
        );
      }
      case "Mermaid":
      case "MermaidChart": {
        const rawChart = resolveDynamic<string>(
          (comp.chart ?? comp.code ?? comp.value) as any,
          dataModel,
          scope,
          index,
        );
        const widthVal =
          resolveDynamic<number | string>(comp.width as any, dataModel, scope, index) ?? "100%";
        const heightVal = resolveDynamic<number | string>(comp.height as any, dataModel, scope, index) ?? 400;
        const titleVal = resolveDynamic<string>(comp.title as any, dataModel, scope, index);
        const themeVal = (comp.theme as any) ?? "dark";
        const action = comp.action as A2uiAction | undefined;

        return (
          <Box key={key} style={style}>
            <MermaidChart
              chart={rawChart ?? ""}
              width={widthVal}
              height={heightVal}
              title={titleVal}
              theme={themeVal}
              onNodeClick={nodeId => {
                if (action) {
                  handleAction(action, { nodeId }, index);
                }
              }}
            />
          </Box>
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
