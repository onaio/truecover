library(jsonlite)
suppressPackageStartupMessages(library(geojsonio))

preprocess_params = dget('function/preprocess_params.R')
run_function = dget('function/function.R')

main = function () {
  tryCatch({
    # reads STDIN as JSON, return error if any problems
    incoming = readLines(file("stdin"), warn=FALSE)
    if (is.null(incoming)) {
      stop("Request received by function is not valid JSON. Please check docs")
    }
    params = fromJSON(incoming)
    
    # checks for existence of required parameters, return error if any problems
    # checks types/structure of all parameters, return error if any problems
    # as required, replace any external URLs with data
    params = preprocess_params(params)

    # run the function with parameters, 
    # return error if any problems, return success if succeeds      
    function_response = run_function(params)
    return(handle_success(function_response))
  }, error = function(e) {
    return(handle_error(e))
  })
}

handle_error = function(error) {
  message(error)
  type = 'error'
  function_response = as.json(list(function_status = unbox(type), result = unbox(unbox(error$message))))
  return(write(function_response, stdout()))
}

handle_success = function(content) {
  type = 'success'
  function_response = as.json(list(function_status = unbox(type), result = content))
  return(write(function_response, stdout()))
}

main()
