import {handleRequest} from './seo-access.mjs';

export default {fetch(request, env) { return handleRequest(request, env); }};
