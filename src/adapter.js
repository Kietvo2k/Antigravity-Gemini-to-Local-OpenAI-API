import crypto from 'crypto';

export class Adapter {
  /**
   * Convert OpenAI Chat Completion request to Google CloudCode request
   */
  static openaiToCloudCode(openaiReq, projectId = 'aicode-consumers') {
    const model = openaiReq.model || 'gemini-3.8-flash-high';
    const contents = [];
    const systemParts = [];

    // Parse messages
    for (const msg of openaiReq.messages || []) {
      if (msg.role === 'system') {
        const text = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
        if (text) systemParts.push({ text });
      } else if (msg.role === 'user') {
        const parts = [];
        if (typeof msg.content === 'string') {
          parts.push({ text: msg.content });
        } else if (Array.isArray(msg.content)) {
          for (const item of msg.content) {
            if (item.type === 'text') {
              parts.push({ text: item.text });
            } else if (item.type === 'image_url' && item.image_url?.url) {
              const url = item.image_url.url;
              if (url.startsWith('data:')) {
                const [meta, base64] = url.split(',');
                const mimeType = meta.split(';')[0].replace('data:', '');
                parts.push({
                  inlineData: { mimeType, data: base64 }
                });
              }
            }
          }
        }
        contents.push({ role: 'user', parts });
      } else if (msg.role === 'assistant') {
        const parts = [];
        if (msg.content) {
          parts.push({ text: msg.content });
        }
        if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
          for (let i = 0; i < msg.tool_calls.length; i++) {
            const tc = msg.tool_calls[i];
            let argsObj = {};
            try {
              argsObj = typeof tc.function.arguments === 'string' 
                ? JSON.parse(tc.function.arguments) 
                : tc.function.arguments;
            } catch (e) {
              argsObj = { raw: tc.function.arguments };
            }
            const signature = tc.thought_signature || tc.thoughtSignature || msg.thought_signature || msg.thoughtSignature || 'skip_thought_signature_validator';
            parts.push({
              functionCall: {
                name: tc.function.name,
                args: argsObj
              },
              thoughtSignature: signature
            });
          }
        }
        contents.push({ role: 'model', parts });
      } else if (msg.role === 'tool') {
        let respObj = {};
        try {
          respObj = typeof msg.content === 'string' ? JSON.parse(msg.content) : msg.content;
        } catch (e) {
          respObj = { result: msg.content };
        }
        contents.push({
          role: 'user',
          parts: [{
            functionResponse: {
              name: msg.name || 'tool_response',
              response: respObj
            }
          }]
        });
      }
    }

    // Parse Tools
    let tools = undefined;
    const rawTools = openaiReq.tools || (openaiReq.functions ? openaiReq.functions.map(fn => ({ type: 'function', function: fn })) : []);

    if (openaiReq.tool_choice !== 'none' && Array.isArray(rawTools) && rawTools.length > 0) {
      const functionDeclarations = rawTools
        .filter(t => t.type === 'function' && t.function)
        .map(t => {
          const fn = t.function;
          return {
            name: fn.name,
            description: fn.description || '',
            parameters: Adapter.cleanSchema(fn.parameters || { type: 'object', properties: {} })
          };
        });
      if (functionDeclarations.length > 0) {
        tools = [{ functionDeclarations }];
      }
    }

    const generationConfig = {
      temperature: openaiReq.temperature ?? 0.7,
      topP: openaiReq.top_p ?? 0.95,
      maxOutputTokens: openaiReq.max_tokens || openaiReq.max_completion_tokens || 8192
    };

    const sessionId = crypto.randomUUID();
    const requestId = `agent-${crypto.randomUUID()}`;

    return {
      project: projectId,
      model,
      userAgent: 'antigravity',
      requestId,
      request: {
        sessionId,
        contents,
        ...(systemParts.length > 0 ? { systemInstruction: { parts: systemParts } } : {}),
        ...(tools ? { tools } : {}),
        generationConfig
      }
    };
  }

  /**
   * Convert CloudCode stream candidates chunk to OpenAI SSE chunk
   */
  static cloudCodeChunkToOpenAI(cloudChunk, model, completionId) {
    const candidate = cloudChunk?.response?.candidates?.[0];
    if (!candidate) return null;

    const parts = candidate.content?.parts || [];
    let text = '';
    let reasoning = '';
    let toolCalls = null;

    for (const part of parts) {
      if (part.thought) {
        reasoning += part.thought;
      } else if (part.text) {
        text += part.text;
      } else if (part.functionCall) {
        toolCalls = [{
          index: 0,
          id: `call_${crypto.randomBytes(8).toString('hex')}`,
          type: 'function',
          function: {
            name: part.functionCall.name,
            arguments: JSON.stringify(part.functionCall.args || {})
          }
        }];
      }
    }

    const finishReason = candidate.finishReason 
      ? candidate.finishReason.toLowerCase() 
      : null;

    const delta = {};
    if (text) delta.content = text;
    if (reasoning) delta.reasoning_content = reasoning;
    if (toolCalls) delta.tool_calls = toolCalls;

    if (Object.keys(delta).length === 0 && !finishReason) {
      return null;
    }

    return {
      id: completionId,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [
        {
          index: 0,
          delta,
          finish_reason: finishReason === 'stop' ? 'stop' : (toolCalls ? 'tool_calls' : null)
        }
      ]
    };
  }

  /**
   * Convert Full CloudCode aggregated response to standard OpenAI Non-Streaming Response
   */
  static cloudCodeToOpenAIResponse(aggregated, model, completionId) {
    let content = '';
    let reasoningContent = '';
    let toolCalls = [];
    let finishReason = 'stop';
    let lastUsage = null;

    for (const item of aggregated) {
      if (item?.response?.usageMetadata) {
        lastUsage = item.response.usageMetadata;
      } else if (item?.usageMetadata) {
        lastUsage = item.usageMetadata;
      }
      const cand = item?.response?.candidates?.[0];
      if (cand) {
        if (cand.finishReason) finishReason = cand.finishReason.toLowerCase();
        for (const part of cand.content?.parts || []) {
          if (part.thought) reasoningContent += part.thought;
          if (part.text) content += part.text;
          if (part.functionCall) {
            const sig = part.thoughtSignature || part.thought_signature;
            toolCalls.push({
              id: `call_${crypto.randomBytes(8).toString('hex')}`,
              type: 'function',
              function: {
                name: part.functionCall.name,
                arguments: JSON.stringify(part.functionCall.args || {})
              },
              ...(sig ? { thought_signature: sig } : {})
            });
          }
        }
      }
    }

    const message = {
      role: 'assistant',
      content: content || null
    };

    if (reasoningContent) {
      message.reasoning_content = reasoningContent;
    }
    if (toolCalls.length > 0) {
      message.tool_calls = toolCalls;
      finishReason = 'tool_calls';
    }

    const promptTokens = lastUsage?.promptTokenCount || 0;
    const completionTokens = lastUsage?.candidatesTokenCount || 0;
    const cachedTokens = lastUsage?.cachedContentTokenCount || 0;
    const totalTokens = lastUsage?.totalTokenCount || (promptTokens + completionTokens);

    return {
      id: completionId,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [
        {
          index: 0,
          message,
          finish_reason: finishReason === 'stop' ? 'stop' : finishReason
        }
      ],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: totalTokens,
        prompt_tokens_details: {
          cached_tokens: cachedTokens
        }
      }
    };
  }

  /**
   * Recursively clean and normalize JSON Schema for Google Gemini / CloudCode API
   * Strips all unsupported keywords ($schema, exclusiveMinimum, propertyNames, $id, etc.)
   */
  static cleanSchema(rawSchema, definitionsMap = null) {
    if (!rawSchema || typeof rawSchema !== 'object') {
      return { type: 'object', properties: {} };
    }

    let schema = JSON.parse(JSON.stringify(rawSchema));

    // Extract root definitions if present
    if (!definitionsMap) {
      definitionsMap = new Map();
      const defs = schema.definitions || schema.$defs;
      if (defs && typeof defs === 'object') {
        for (const [k, v] of Object.entries(defs)) {
          definitionsMap.set(`#/definitions/${k}`, v);
          definitionsMap.set(`#/$defs/${k}`, v);
        }
      }
    }

    // Resolve $ref
    if (schema.$ref && typeof schema.$ref === 'string') {
      const target = definitionsMap.get(schema.$ref);
      if (target && typeof target === 'object') {
        const resolved = Adapter.cleanSchema(target, definitionsMap);
        delete schema.$ref;
        Object.assign(schema, resolved);
      } else {
        delete schema.$ref;
      }
    }

    // Handle type array: ["string", "null"]
    if (Array.isArray(schema.type)) {
      if (schema.type.includes('null')) {
        schema.nullable = true;
      }
      const validTypes = schema.type.filter(t => t !== 'null');
      schema.type = validTypes[0] || 'string';
    }

    if (typeof schema.type === 'string') {
      schema.type = schema.type.toLowerCase();
    }

    // If properties present but no type, default to 'object'
    if (schema.properties && !schema.type) {
      schema.type = 'object';
    }

    // If type is array but items missing, add fallback
    if (schema.type === 'array' && !schema.items) {
      schema.items = {};
    }

    // Handle enum: convert items to string, handle null
    if (Array.isArray(schema.enum)) {
      if (schema.enum.includes(null)) {
        schema.nullable = true;
      }
      schema.enum = schema.enum.filter(x => x !== null).map(x => String(x));
      if (schema.enum.length === 0) {
        delete schema.enum;
      }
    }

    // Handle const -> enum
    if (schema.const !== undefined) {
      if (!schema.type) {
        schema.type = typeof schema.const === 'number' ? 'number' : typeof schema.const === 'boolean' ? 'boolean' : 'string';
      }
      schema.enum = [String(schema.const)];
      delete schema.const;
    }

    // Handle exclusiveMinimum / exclusiveMaximum
    if (schema.exclusiveMinimum !== undefined) {
      if (typeof schema.exclusiveMinimum === 'number' && schema.minimum === undefined) {
        schema.minimum = schema.exclusiveMinimum;
      }
      delete schema.exclusiveMinimum;
    }
    if (schema.exclusiveMaximum !== undefined) {
      if (typeof schema.exclusiveMaximum === 'number' && schema.maximum === undefined) {
        schema.maximum = schema.exclusiveMaximum;
      }
      delete schema.exclusiveMaximum;
    }

    // Handle examples -> example
    if (Array.isArray(schema.examples)) {
      if (schema.example === undefined && schema.examples.length > 0) {
        schema.example = schema.examples[0];
      }
      delete schema.examples;
    }

    // Handle format validation for Gemini
    if (schema.format) {
      const allowedFormats = new Set(['float', 'double', 'int32', 'int64', 'date-time', 'date', 'time', 'email', 'enum']);
      if (!allowedFormats.has(schema.format)) {
        delete schema.format;
      } else if (schema.format === 'enum' && (!schema.enum || schema.enum.length === 0)) {
        delete schema.format;
      }
    }

    // Clean properties recursively
    if (schema.properties && typeof schema.properties === 'object' && !Array.isArray(schema.properties)) {
      const cleanedProps = {};
      for (const [k, v] of Object.entries(schema.properties)) {
        cleanedProps[k] = Adapter.cleanSchema(v, definitionsMap);
      }
      schema.properties = cleanedProps;
    }

    // Clean required: must be an array of strings that exist in properties
    if (Array.isArray(schema.required)) {
      if (schema.properties && typeof schema.properties === 'object') {
        const validPropKeys = new Set(Object.keys(schema.properties));
        schema.required = schema.required.filter(k => typeof k === 'string' && validPropKeys.has(k));
      } else {
        delete schema.required;
      }
    } else {
      delete schema.required;
    }

    // Clean items
    if (schema.items) {
      if (Array.isArray(schema.items)) {
        schema.items = schema.items.length > 0 ? Adapter.cleanSchema(schema.items[0], definitionsMap) : {};
      } else if (typeof schema.items === 'object') {
        schema.items = Adapter.cleanSchema(schema.items, definitionsMap);
      }
    }

    // Clean additionalProperties
    if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
      schema.additionalProperties = Adapter.cleanSchema(schema.additionalProperties, definitionsMap);
    }

    // Clean anyOf, allOf, oneOf
    for (const combiner of ['anyOf', 'allOf', 'oneOf']) {
      if (Array.isArray(schema[combiner])) {
        schema[combiner] = schema[combiner].map(s => Adapter.cleanSchema(s, definitionsMap));
      }
    }

    // Clean prefixItems
    if (Array.isArray(schema.prefixItems)) {
      schema.prefixItems = schema.prefixItems.map(s => Adapter.cleanSchema(s, definitionsMap));
    }

    // Clean not
    if (schema.not && typeof schema.not === 'object') {
      schema.not = Adapter.cleanSchema(schema.not, definitionsMap);
    }

    // Filter to only fields supported by Google Gemini Schema proto
    const ALLOWED_SCHEMA_KEYS = new Set([
      'type',
      'format',
      'description',
      'nullable',
      'enum',
      'maxItems',
      'minItems',
      'properties',
      'required',
      'items',
      'minProperties',
      'maxProperties',
      'minimum',
      'maximum',
      'minLength',
      'maxLength',
      'pattern',
      'example',
      'title',
      'default',
      'additionalProperties',
      'anyOf',
      'allOf',
      'oneOf',
      'not',
      'prefixItems'
    ]);

    const result = {};
    for (const key of Object.keys(schema)) {
      if (ALLOWED_SCHEMA_KEYS.has(key)) {
        result[key] = schema[key];
      }
    }

    if (!result.type && result.properties) {
      result.type = 'object';
    }

    return result;
  }
}
