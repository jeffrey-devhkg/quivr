/* eslint-disable complexity */
/* eslint-disable max-lines */
import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import { UUID } from "crypto";
import { useCallback, useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { getBrainDataKey } from "@/lib/api/brain/config";
import { useBrainApi } from "@/lib/api/brain/useBrainApi";
import { usePromptApi } from "@/lib/api/prompt/usePromptApi";
import { USER_DATA_KEY } from "@/lib/api/user/config";
import { useUserApi } from "@/lib/api/user/useUserApi";
import { defaultBrainConfig } from "@/lib/config/defaultBrainConfig";
import { useBrainContext } from "@/lib/context/BrainProvider/hooks/useBrainContext";
import { Brain } from "@/lib/context/BrainProvider/types";
import { defineMaxTokens } from "@/lib/helpers/defineMaxTokens";
import { getAccessibleModels } from "@/lib/helpers/getAccessibleModels";
import { useToast } from "@/lib/hooks";

import { validateOpenAIKey } from "../utils/validateOpenAIKey";

type UseSettingsTabProps = {
  brainId: UUID;
};

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export const useSettingsTab = ({ brainId }: UseSettingsTabProps) => {
  const { t } = useTranslation(["translation", "brain", "config"]);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isSettingAsDefault, setIsSettingAsDefault] = useState(false);
  const { publish } = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const { setAsDefaultBrain, getBrain, updateBrain } = useBrainApi();
  const { fetchAllBrains, fetchDefaultBrain, defaultBrainId } =
    useBrainContext();
  const { getPrompt, updatePrompt, createPrompt } = usePromptApi();
  const { getUser } = useUserApi();

  const { data: userData } = useQuery({
    queryKey: [USER_DATA_KEY],
    queryFn: getUser,
  });

  const defaultValues = {
    ...defaultBrainConfig,
    name: "",
    description: "",
    setDefault: false,
    prompt_id: "",
    prompt: {
      title: "",
      content: "",
    },
  };

  const {
    register,
    getValues,
    watch,
    setValue,
    reset,
    formState: { dirtyFields },
  } = useForm({
    defaultValues,
  });

  const { data: brain } = useQuery({
    queryKey: [getBrainDataKey(brainId)],
    queryFn: () => getBrain(brainId),
  });

  const isDefaultBrain = defaultBrainId === brainId;
  const promptId = watch("prompt_id");
  const openAiKey = watch("openAiKey");
  const model = watch("model");
  const temperature = watch("temperature");
  const maxTokens = watch("maxTokens");

  const accessibleModels = getAccessibleModels({
    openAiKey,
    userData,
  });

  const updateFormValues = useCallback(() => {
    if (brain === undefined) {
      return;
    }

    for (const key in brain) {
      const brainKey = key as keyof Brain;
      if (!(key in brain)) {
        return;
      }

      if (brainKey === "max_tokens" && brain["max_tokens"] !== undefined) {
        setValue("maxTokens", brain["max_tokens"]);
        continue;
      }

      if (brainKey === "openai_api_key") {
        setValue("openAiKey", brain["openai_api_key"] ?? "");
        continue;
      }

      // @ts-expect-error bad type inference from typescript
      // eslint-disable-next-line
      if (Boolean(brain[key])) setValue(key, brain[key]);
    }

    setTimeout(() => {
      if (brain.model !== undefined) {
        setValue("model", brain.model);
      }
    }, 50);
  }, [brain, setValue]);

  useEffect(() => {
    updateFormValues();
  }, [brain, updateFormValues]);

  useEffect(() => {
    setValue("maxTokens", Math.min(maxTokens, defineMaxTokens(model)));
  }, [maxTokens, model, setValue]);

  useEffect(() => {
    const handleKeyPress = (event: KeyboardEvent) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void handleSubmit(true);
      }
    };

    formRef.current?.addEventListener("keydown", handleKeyPress);

    return () => {
      formRef.current?.removeEventListener("keydown", handleKeyPress);
    };
  }, [formRef.current]);

  const fetchPrompt = async () => {
    if (promptId === "") {
      return;
    }

    const prompt = await getPrompt(promptId);
    if (prompt === undefined) {
      return;
    }
    setValue("prompt", prompt);
  };
  useEffect(() => {
    void fetchPrompt();
  }, [promptId]);

  const setAsDefaultBrainHandler = async () => {
    try {
      setIsSettingAsDefault(true);
      await setAsDefaultBrain(brainId);
      publish({
        variant: "success",
        text: t("defaultBrainSet", { ns: "config" }),
      });
      void fetchAllBrains();
      void fetchDefaultBrain();
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 429) {
        publish({
          variant: "danger",
          text: `${JSON.stringify(
            (
              err.response as {
                data: { detail: string };
              }
            ).data.detail
          )}`,
        });

        return;
      }
    } finally {
      setIsSettingAsDefault(false);
    }
  };

  const removeBrainPrompt = async () => {
    try {
      setIsUpdating(true);
      await updateBrain(brainId, {
        prompt_id: null,
      });
      setValue("prompt", {
        title: "",
        content: "",
      });
      reset();
      void updateFormValues();
      publish({
        variant: "success",
        text: t("promptRemoved", { ns: "config" }),
      });
    } catch (err) {
      publish({
        variant: "danger",
        text: t("errorRemovingPrompt", { ns: "config" }),
      });
    } finally {
      setIsUpdating(false);
    }
  };

  const promptHandler = async () => {
    const { prompt } = getValues();

    if (dirtyFields["prompt"]) {
      await updatePrompt(promptId, {
        title: prompt.title,
        content: prompt.content,
      });
    }
  };

  const handleSubmit = async (checkDirty: boolean) => {
    const hasChanges = Object.keys(dirtyFields).length > 0;
    if (!hasChanges && checkDirty) {
      return;
    }
    const { name, openAiKey: openai_api_key } = getValues();

    if (name.trim() === "") {
      publish({
        variant: "danger",
        text: t("nameRequired", { ns: "config" }),
      });

      return;
    }

    if (
      openai_api_key !== undefined &&
      openai_api_key !== "" &&
      !(await validateOpenAIKey(
        openai_api_key,
        {
          badApiKeyError: t("incorrectApiKey", { ns: "config" }),
          invalidApiKeyError: t("invalidApiKeyError", { ns: "config" }),
        },
        publish
      ))
    ) {
      return;
    }

    try {
      setIsUpdating(true);
      const { maxTokens: max_tokens, prompt, ...otherConfigs } = getValues();

      if (
        dirtyFields["prompt"] &&
        (prompt.content === "" || prompt.title === "")
      ) {
        publish({
          variant: "warning",
          text: t("promptFieldsRequired", { ns: "config" }),
        });

        return;
      }

      if (dirtyFields["prompt"]) {
        if (promptId === "") {
          otherConfigs["prompt_id"] = (
            await createPrompt({
              title: prompt.title,
              content: prompt.content,
            })
          ).id;
          await updateBrain(brainId, {
            ...otherConfigs,
            max_tokens,
            openai_api_key,
          });
          void updateFormValues();
        } else {
          await Promise.all([
            updateBrain(brainId, {
              ...otherConfigs,
              max_tokens,
              openai_api_key,
            }),
            promptHandler(),
          ]);
        }
      } else {
        await updateBrain(brainId, {
          ...otherConfigs,
          max_tokens,
          openai_api_key,
          prompt_id:
            otherConfigs["prompt_id"] !== ""
              ? otherConfigs["prompt_id"]
              : undefined,
        });
      }

      publish({
        variant: "success",
        text: t("brainUpdated", { ns: "config" }),
      });
      void fetchAllBrains();
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 429) {
        publish({
          variant: "danger",
          text: `${JSON.stringify(
            (
              err.response as {
                data: { detail: string };
              }
            ).data.detail
          )}`,
        });
      } else {
        publish({
          variant: "danger",
          text: `${JSON.stringify(err)}`,
        });
      }
    } finally {
      setIsUpdating(false);
    }
  };

  const pickPublicPrompt = ({
    title,
    content,
  }: {
    title: string;
    content: string;
  }): void => {
    setValue("prompt.title", title, {
      shouldDirty: true,
    });
    setValue("prompt.content", content, {
      shouldDirty: true,
    });
  };

  return {
    handleSubmit,
    register,

    model,
    temperature,
    maxTokens,
    isUpdating,
    setAsDefaultBrainHandler,
    isSettingAsDefault,
    isDefaultBrain,
    formRef,
    promptId,
    removeBrainPrompt,
    pickPublicPrompt,
    accessibleModels,
  };
};
